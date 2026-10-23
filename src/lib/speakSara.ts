import { currentSaraPass } from './demoPass.ts'
import { rewritePfilatesForSpeech } from './pfilatesSpeech.mjs'
import { SARA_BUSY_MESSAGE, SARA_UNKNOWN_PASS_MESSAGE } from './saraGate.ts'
import { splitSpeakChunks } from './speakChunks.mjs'

const MUTE_KEY = 'sara.voiceMuted'

/**
 * Short silent WAV. Played on the persistent element inside the Send/Play
 * tap so later blob playback can reuse that element. Not paused afterwards:
 * pausing here is what re-locks the element before /ask returns.
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

/** Wall-clock budget after play() for currentTime to move. */
const ADVANCE_LIMIT_MS = 1500

/** Keep the glow up across a chunk swap so the ring does not blink off. */
const ADVANCE_GRACE_MS = 240

export const SARA_VOICE_OFFLINE =
  "I couldn't reach my voice just now. Tap Play in a moment — I won't fake it from the phone speaker."

export const SARA_TAP_TO_HEAR = 'Tap to hear Sara'

export const SARA_SILENT_SWITCH_HINT =
  'If you hear nothing, turn off the Silent switch and turn up the volume'

/** One short sentence. Goes through POST /speak, so demo limits still count it. */
export const SARA_TEST_VOICE_LINE = "Hi, it's Sara."

function apiBase(): string {
  return (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
}

export function isVoiceReady(): boolean {
  return typeof window !== 'undefined' && typeof Audio !== 'undefined'
}

/** @deprecated Use isVoiceReady — neural TTS is the path, not Web Speech. */
export function isSpeechSupported(): boolean {
  return isVoiceReady()
}

export function isSaraMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

type LevelListener = (level: number, audible: boolean) => void

type SpeakOpts = {
  onStart?: () => void
  onEnd?: () => void
  onLevel?: (level: number) => void
  onError?: (message: string) => void
  /** play() rejected, or currentTime did not advance within 1.5s. */
  onBlocked?: () => void
  /** First chunk's blob URL is stored. May still be held and not playing. */
  onFirstChunk?: () => void
}

type ChunkSlot = {
  url: string | null
  error: 'busy' | 'denied' | 'offline' | null
}

type Engine = {
  audio: HTMLAudioElement
  generation: number
  playToken: number
  urls: Array<string | null>
  slots: ChunkSlot[]
  index: number
  chunkCount: number
  waiting: boolean
  speech: boolean
  closed: boolean
  blocked: boolean
  started: boolean
  opts: SpeakOpts
  raf: number
  stallTimer: number
  advanceForToken: number
  smoothed: number
  lastSample: number
  sawTime: boolean
  lastAdvanceAt: number
  playingEvent: boolean
  /** playToken that has fired 'playing'. Ended before that is a src swap. */
  heardToken: number
  /** Prefetch only. acceptChunk must not play until release. Do not pause while held. */
  holding: boolean
}

let engine: Engine | null = null
const levelListeners = new Set<LevelListener>()

function emitLevel(level: number, audible: boolean): void {
  const clamped = Math.max(0, Math.min(0.9, level))
  for (const listener of levelListeners) listener(clamped, audible)
  engine?.opts.onLevel?.(clamped)
}

/** Portrait glow reads this. Does not re-render the chat thread. */
export function subscribeSaraLevel(listener: LevelListener): () => void {
  levelListeners.add(listener)
  return () => {
    levelListeners.delete(listener)
  }
}

export function setSaraMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (muted) stopSaraSpeech()
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError'
}

/**
 * Smoothed syllable-like level in 0.25–0.9. The media element is the sound.
 * A graph tap on that element would pull output off the media channel, which
 * is the path the hardware silent switch mutes, so the ring is synthetic.
 */
function speechEnvelope(seconds: number): number {
  const n =
    Math.abs(Math.sin(seconds * 11.2)) * 0.5 +
    Math.abs(Math.sin(seconds * 4.1 + 0.7)) * 0.3 +
    Math.abs(Math.sin(seconds * 17.3 + 1.9)) * 0.2
  return 0.25 + Math.min(1, n) * 0.65
}

function bindElement(audio: HTMLAudioElement): void {
  audio.addEventListener('playing', () => {
    if (!engine || !engine.speech) return
    engine.playingEvent = true
    engine.heardToken = engine.playToken
  })
  audio.addEventListener('pause', () => {
    if (!engine) return
    engine.playingEvent = false
  })
  audio.addEventListener('ended', () => {
    if (!engine) return
    const heard =
      engine.heardToken === engine.playToken && engine.speech && !engine.closed && !engine.blocked
    engine.playingEvent = false
    if (!heard) return
    engine.heardToken = -1
    onSpeechEnded()
  })
}

function ensureEngine(): Engine | null {
  if (engine) return engine
  if (typeof document === 'undefined') return null
  const parent = document.body ?? document.documentElement
  if (!parent) return null
  const audio = document.createElement('audio')
  audio.preload = 'auto'
  ;(audio as HTMLAudioElement & { playsInline: boolean }).playsInline = true
  audio.setAttribute('playsinline', 'true')
  audio.setAttribute('webkit-playsinline', 'true')
  audio.setAttribute('data-sara-voice', 'true')
  audio.setAttribute('aria-hidden', 'true')
  audio.controls = false
  audio.autoplay = false
  audio.style.position = 'fixed'
  audio.style.width = '0'
  audio.style.height = '0'
  audio.style.opacity = '0'
  audio.style.pointerEvents = 'none'
  parent.appendChild(audio)
  bindElement(audio)
  engine = {
    audio,
    generation: 0,
    playToken: 0,
    urls: [],
    slots: [],
    index: 0,
    chunkCount: 0,
    waiting: false,
    speech: false,
    closed: true,
    blocked: false,
    started: false,
    opts: {},
    raf: 0,
    stallTimer: 0,
    advanceForToken: 0,
    smoothed: 0,
    lastSample: 0,
    sawTime: false,
    lastAdvanceAt: 0,
    playingEvent: false,
    heardToken: -1,
    holding: false,
  }
  return engine
}

function revokeUrls(current: Engine): void {
  for (const url of current.urls) {
    if (url) URL.revokeObjectURL(url)
  }
  current.urls = current.urls.map(() => null)
  for (const slot of current.slots) {
    if (slot) slot.url = null
  }
}

function clearStall(current: Engine): void {
  if (current.stallTimer) {
    window.clearTimeout(current.stallTimer)
    current.stallTimer = 0
  }
}

export function stopSaraSpeech(): void {
  if (!engine) return
  engine.generation += 1
  engine.speech = false
  engine.closed = true
  engine.waiting = false
  engine.blocked = false
  engine.playingEvent = false
  engine.holding = false
  engine.lastAdvanceAt = 0
  clearStall(engine)
  try {
    engine.audio.pause()
  } catch {
    /* ignore */
  }
  try {
    engine.audio.removeAttribute('src')
  } catch {
    /* ignore */
  }
  revokeUrls(engine)
  engine.smoothed = 0
  emitLevel(0, false)
}

/**
 * Call from the Send / Play / Test voice tap, before any await.
 * Plays silence on the one element and leaves it in place for the reply.
 */
export function unlockSaraSpeech(): void {
  const current = ensureEngine()
  if (!current || current.speech) return
  const audio = current.audio
  try {
    audio.muted = false
    audio.volume = 1
    audio.loop = false
    audio.src = SILENT_WAV
    const pending = audio.play()
    if (pending) void pending.catch(() => {})
  } catch {
    /* a later tap can try again */
  }
}

function startLevels(current: Engine): void {
  if (current.raf) return
  const tick = () => {
    current.raf = 0
    if (!engine) return
    stepEnvelope(engine)
    if (engine.speech || engine.smoothed > 0.02) {
      engine.raf = requestAnimationFrame(tick)
    } else {
      engine.smoothed = 0
      emitLevel(0, false)
    }
  }
  current.raf = requestAnimationFrame(tick)
}

function stepEnvelope(current: Engine): void {
  const audio = current.audio
  const now = performance.now()
  let advancing = false
  if (current.speech && !current.blocked && !current.closed) {
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    if (!current.sawTime) {
      current.sawTime = true
      current.lastSample = t
    } else {
      const eventLive = current.playingEvent && !audio.paused && !audio.ended
      if (eventLive && t > current.lastSample + 0.01) {
        advancing = true
        current.lastAdvanceAt = now
        if (current.advanceForToken !== current.playToken) {
          current.advanceForToken = current.playToken
          clearStall(current)
        }
        if (!current.started) {
          current.started = true
          current.opts.onStart?.()
        }
      }
      current.lastSample = t
    }
  }
  const grace =
    current.speech &&
    !current.blocked &&
    !current.closed &&
    current.lastAdvanceAt > 0 &&
    now - current.lastAdvanceAt < ADVANCE_GRACE_MS
  const fresh = advancing || grace
  if (fresh) {
    const target = speechEnvelope(now / 1000)
    if (current.smoothed < 0.25) current.smoothed = 0.25
    current.smoothed += (target - current.smoothed) * 0.2
    if (current.smoothed > 0.9) current.smoothed = 0.9
  } else {
    current.smoothed += (0 - current.smoothed) * 0.28
    if (current.smoothed < 0.02) current.smoothed = 0
  }
  const audible = fresh && current.smoothed >= 0.25
  emitLevel(current.smoothed, audible)
}

function signalBlocked(current: Engine): void {
  if (current.blocked || current.closed || !current.speech) return
  current.blocked = true
  current.speech = false
  current.waiting = false
  current.playingEvent = false
  current.lastAdvanceAt = 0
  clearStall(current)
  try {
    current.audio.pause()
  } catch {
    /* ignore */
  }
  current.smoothed = 0
  emitLevel(0, false)
  current.opts.onBlocked?.()
}

function assignSrcAndPlay(current: Engine, url: string): void {
  const gen = current.generation
  current.playToken += 1
  const token = current.playToken
  current.sawTime = false
  current.playingEvent = false
  current.speech = true
  current.waiting = false
  current.audio.loop = false
  current.audio.muted = false
  current.audio.volume = 1
  current.audio.src = url
  clearStall(current)
  current.stallTimer = window.setTimeout(() => {
    if (!engine || engine.generation !== gen || engine.playToken !== token) return
    if (engine.advanceForToken === token || engine.blocked || engine.closed || !engine.speech) return
    signalBlocked(engine)
  }, ADVANCE_LIMIT_MS)
  startLevels(current)
  try {
    const pending = current.audio.play()
    if (pending && typeof pending.then === 'function') {
      void pending.then(
        () => {},
        (err: unknown) => {
          if (!engine || engine.generation !== gen || engine.playToken !== token) return
          if (engine.advanceForToken === token || isAbort(err)) return
          signalBlocked(engine)
        },
      )
    }
  } catch {
    signalBlocked(current)
  }
}

function failFetch(current: Engine, kind: 'busy' | 'denied' | 'offline'): void {
  if (current.closed) return
  current.closed = true
  current.speech = false
  current.waiting = false
  current.playingEvent = false
  clearStall(current)
  const message =
    kind === 'busy' ? SARA_BUSY_MESSAGE : kind === 'denied' ? SARA_UNKNOWN_PASS_MESSAGE : SARA_VOICE_OFFLINE
  current.opts.onError?.(message)
  current.opts.onEnd?.()
}

function finishPlayback(current: Engine): void {
  if (current.closed) return
  current.closed = true
  current.speech = false
  current.waiting = false
  current.playingEvent = false
  clearStall(current)
  revokeUrls(current)
  current.opts.onEnd?.()
}

function onSpeechEnded(): void {
  const current = engine
  if (!current || !current.speech || current.closed || current.blocked) return
  const next = current.index + 1
  if (next >= current.chunkCount) {
    finishPlayback(current)
    return
  }
  const slot = current.slots[next]
  if (slot?.url) {
    current.index = next
    assignSrcAndPlay(current, slot.url)
    return
  }
  if (slot?.error) {
    failFetch(current, slot.error)
    return
  }
  current.index = next
  current.waiting = true
}

function acceptChunk(gen: number, index: number, blob: Blob | null | 'busy' | 'denied'): void {
  const current = engine
  if (!current || current.generation !== gen || current.closed) return
  const slot = current.slots[index]
  if (!slot || slot.url || slot.error) return
  if (blob === 'busy' || blob === 'denied' || !blob) {
    slot.error = blob === 'busy' ? 'busy' : blob === 'denied' ? 'denied' : 'offline'
    if (current.holding) {
      if (index === 0) current.opts.onFirstChunk?.()
      return
    }
    const readyToPlay = index === 0 ? !current.speech : current.waiting && current.index === index
    if (readyToPlay) failFetch(current, slot.error)
    return
  }
  const url = URL.createObjectURL(blob)
  if (!engine || engine.generation !== gen || engine.closed) {
    URL.revokeObjectURL(url)
    return
  }
  slot.url = url
  current.urls[index] = url
  if (current.holding) {
    if (index === 0) current.opts.onFirstChunk?.()
    return
  }
  if (index === 0) current.opts.onFirstChunk?.()
  if (current.blocked) return
  if (index === 0 && !current.speech) {
    current.index = 0
    assignSrcAndPlay(current, url)
    return
  }
  if (current.waiting && current.index === index) assignSrcAndPlay(current, url)
}

export async function fetchSaraSpeech(text: string): Promise<Blob | null | 'busy' | 'denied'> {
  const clean = rewritePfilatesForSpeech(text.replace(/\s+/g, ' ').trim())
  if (!clean) return null
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(`${apiBase()}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ text: clean, pass: currentSaraPass() }),
    })
    if (res.status === 429) return 'busy'
    if (res.status === 401 || res.status === 403) return 'denied'
    const type = res.headers.get('content-type') || ''
    if (!res.ok || type.includes('json') || type.includes('text')) return null
    const blob = await res.blob()
    if (!blob.size) return null
    return blob
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * Replay the chunks already fetched, from this tap, with no await first.
 * Returns false when there is nothing cached, so the caller can unlock and
 * fetch again inside the same tap.
 */
export function playCachedSaraSpeech(): boolean {
  const current = engine
  if (!current || (current.speech && !current.closed)) return false
  const first = current.urls[0] ?? current.slots[0]?.url ?? null
  if (!first) return false
  current.blocked = false
  current.closed = false
  current.started = false
  current.waiting = false
  current.index = 0
  current.opts = current.opts ?? {}
  assignSrcAndPlay(current, first)
  return true
}

function startSpeak(text: string, opts: SpeakOpts, holding: boolean): void {
  if (!isVoiceReady() || isSaraMuted()) {
    opts.onEnd?.()
    return
  }
  const chunks = splitSpeakChunks(text)
  if (!chunks.length) {
    opts.onEnd?.()
    return
  }
  const current = ensureEngine()
  if (!current) {
    opts.onEnd?.()
    return
  }

  current.generation += 1
  const gen = current.generation
  current.opts = opts
  current.closed = false
  current.blocked = false
  current.started = false
  current.waiting = false
  current.speech = false
  current.holding = holding
  current.index = 0
  current.chunkCount = chunks.length
  current.slots = chunks.map(() => ({ url: null, error: null }))
  revokeUrls(current)
  current.urls = chunks.map(() => null)
  clearStall(current)

  const jobs = chunks.map((chunk) => fetchSaraSpeech(chunk))
  for (let i = 0; i < jobs.length; i += 1) {
    void jobs[i].then((blob) => {
      acceptChunk(gen, i, blob)
    })
  }
}

/** True once the first held or playing chunk has a blob URL. */
export function saraSpeechChunkReady(): boolean {
  const current = engine
  if (!current || current.closed) return false
  return Boolean(current.slots[0]?.url)
}

/**
 * Fetch chunks without playing. Does not pause the element, so an unlock
 * from the same tap stays valid until release or an explicit stop.
 */
export function holdSaraSpeech(text: string, opts: SpeakOpts = {}): void {
  startSpeak(text, opts, true)
}

/** Play a held reply. Later chunks still advance on ended. */
export function releaseHeldSaraSpeech(): boolean {
  const current = engine
  if (!current || current.closed || !current.holding) return false
  current.holding = false
  if (current.blocked || current.speech) return current.speech
  const slot = current.slots[0]
  if (slot?.error) {
    failFetch(current, slot.error)
    return false
  }
  if (slot?.url) {
    current.index = 0
    assignSrcAndPlay(current, slot.url)
    return true
  }
  return false
}

/** Discard a held reply without pausing. In-flight fetches are ignored. */
export function dropHeldSaraSpeech(): void {
  const current = engine
  if (!current || !current.holding) return
  current.holding = false
  current.generation += 1
  current.closed = true
  current.speech = false
  current.waiting = false
  revokeUrls(current)
}

export async function speakSara(text: string, opts: SpeakOpts = {}): Promise<void> {
  startSpeak(text, opts, false)
}
