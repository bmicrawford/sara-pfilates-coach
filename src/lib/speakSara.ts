import { currentSaraPass } from './demoPass.ts'
import { rewritePfilatesForSpeech } from './pfilatesSpeech.mjs'
import { SARA_BUSY_MESSAGE, SARA_UNKNOWN_PASS_MESSAGE } from './saraGate.ts'
import { splitSpeakChunks } from './speakChunks.mjs'

const MUTE_KEY = 'sara.voiceMuted'

export const SARA_VOICE_OFFLINE =
  "I couldn't reach my voice just now. Tap Play in a moment — I won't fake it from the phone speaker."

function apiBase(): string {
  return (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
}

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const webkit = (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  return window.AudioContext || webkit || null
}

export function isVoiceReady(): boolean {
  return audioContextCtor() != null
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

type LevelListener = (level: number) => void

type Player = {
  ctx: AudioContext
  analyser: AnalyserNode
  hold: AudioBufferSourceNode | null
  speech: Set<AudioBufferSourceNode>
  generation: number
  raf: number
}

let player: Player | null = null
const levelListeners = new Set<LevelListener>()

function emitLevel(level: number): void {
  for (const listener of levelListeners) listener(level)
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

function ensurePlayer(): Player | null {
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  if (player) return player
  const ctx = new Ctor()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.62
  analyser.connect(ctx.destination)
  player = {
    ctx,
    analyser,
    hold: null,
    speech: new Set(),
    generation: 0,
    raf: 0,
  }
  return player
}

function rmsLevel(analyser: AnalyserNode): number {
  const buf = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i += 1) {
    const v = (buf[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / buf.length)
}

function stopLevels(current: Player): void {
  if (current.raf) {
    cancelAnimationFrame(current.raf)
    current.raf = 0
  }
}

function stopSpeechSources(current: Player): void {
  for (const source of current.speech) {
    try {
      source.onended = null
      source.stop()
    } catch {
      /* already stopped */
    }
  }
  current.speech.clear()
}

export function stopSaraSpeech(): void {
  if (!player) return
  player.generation += 1
  stopLevels(player)
  stopSpeechSources(player)
  emitLevel(0)
}

/**
 * Call from the Send / Play tap, before any await.
 * iOS and Android only unlock audio inside that gesture. A muted clip that
 * is paused after the tap re-locks playback, so the /ask round trip then
 * plays silence. Resume the context and start a silent buffer here, and
 * leave that buffer running so later speech buffers can start.
 */
export function unlockSaraSpeech(): void {
  const current = ensurePlayer()
  if (!current) return
  try {
    void current.ctx.resume()
    if (!current.hold) {
      const buffer = current.ctx.createBuffer(1, current.ctx.sampleRate, current.ctx.sampleRate)
      const source = current.ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = current.ctx.createGain()
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(current.ctx.destination)
      source.start()
      current.hold = source
    }
  } catch {
    /* a later Play tap can try again */
  }
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

async function decodeAudio(ctx: AudioContext, blob: Blob): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer()
  return ctx.decodeAudioData(bytes.slice(0))
}

type SpeakOpts = {
  onStart?: () => void
  onEnd?: () => void
  onLevel?: (level: number) => void
  onError?: (message: string) => void
}

function startLevels(current: Player, gen: number, opts: SpeakOpts): void {
  const tick = () => {
    if (!player || gen !== player.generation) {
      emitLevel(0)
      opts.onLevel?.(0)
      return
    }
    const level = Math.min(1, rmsLevel(current.analyser) * 7.2)
    emitLevel(level)
    opts.onLevel?.(level)
    current.raf = requestAnimationFrame(tick)
  }
  current.raf = requestAnimationFrame(tick)
}

export async function speakSara(text: string, opts: SpeakOpts = {}): Promise<void> {
  if (!isVoiceReady() || isSaraMuted()) {
    opts.onEnd?.()
    return
  }
  const chunks = splitSpeakChunks(text)
  if (!chunks.length) {
    opts.onEnd?.()
    return
  }

  const current = ensurePlayer()
  if (!current) {
    opts.onEnd?.()
    return
  }
  current.generation += 1
  const gen = current.generation
  stopLevels(current)
  stopSpeechSources(current)

  const jobs = chunks.map((chunk) => fetchSaraSpeech(chunk))
  let scheduled = 0
  let finished = 0
  let started = false
  let scheduling = true
  let nextTime = 0
  let closed = false

  const finish = () => {
    if (closed || gen !== current.generation) return
    closed = true
    stopLevels(current)
    emitLevel(0)
    opts.onLevel?.(0)
    opts.onEnd?.()
  }

  const fail = (message: string) => {
    scheduling = false
    opts.onError?.(message)
    if (!started || finished >= scheduled) finish()
  }

  for (let i = 0; i < jobs.length; i += 1) {
    if (gen !== current.generation) return
    const blob = await jobs[i]
    if (gen !== current.generation) return
    if (blob === 'busy') {
      fail(SARA_BUSY_MESSAGE)
      return
    }
    if (blob === 'denied') {
      fail(SARA_UNKNOWN_PASS_MESSAGE)
      return
    }
    if (!blob) {
      fail(SARA_VOICE_OFFLINE)
      return
    }

    let audioBuf: AudioBuffer
    try {
      audioBuf = await decodeAudio(current.ctx, blob)
    } catch {
      fail(SARA_VOICE_OFFLINE)
      return
    }
    if (gen !== current.generation) return

    try {
      if (current.ctx.state === 'suspended') await current.ctx.resume()
    } catch {
      /* play anyway if the context is already running */
    }
    if (current.ctx.state === 'suspended') {
      fail(SARA_VOICE_OFFLINE)
      return
    }

    const source = current.ctx.createBufferSource()
    source.buffer = audioBuf
    source.connect(current.analyser)
    const now = current.ctx.currentTime
    const when = started ? Math.max(nextTime, now + 0.01) : now + 0.02
    try {
      source.start(when)
    } catch {
      fail(SARA_VOICE_OFFLINE)
      return
    }
    nextTime = when + (Number.isFinite(audioBuf.duration) ? audioBuf.duration : 0)
    scheduled += 1
    current.speech.add(source)
    source.onended = () => {
      current.speech.delete(source)
      if (gen !== current.generation) return
      finished += 1
      if (!scheduling && finished >= scheduled) finish()
    }
    if (!started) {
      started = true
      opts.onStart?.()
      startLevels(current, gen, opts)
    }
  }

  scheduling = false
  if (gen !== current.generation) return
  if (!started || finished >= scheduled) finish()
}
