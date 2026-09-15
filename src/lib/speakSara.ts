const MUTE_KEY = 'sara.voiceMuted'

/** Tiny silent WAV so iOS Safari unlocks playback from the Send tap. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

export const SARA_VOICE_OFFLINE =
  "Sara’s voice isn’t on this API yet — pull main and restart the Grok proxy (same XAI_API_KEY)."

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

export function setSaraMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (muted) stopSaraSpeech()
}

type Engine = {
  audio: HTMLAudioElement
  ctx: AudioContext | null
  analyser: AnalyserNode | null
  source: MediaElementAudioSourceNode | null
  raf: number
  objectUrl: string | null
  generation: number
}

let engine: Engine | null = null

function ensureEngine(): Engine {
  if (engine) return engine
  const audio = new Audio()
  audio.preload = 'auto'
  audio.setAttribute('playsinline', 'true')
  audio.setAttribute('webkit-playsinline', 'true')
  engine = {
    audio,
    ctx: null,
    analyser: null,
    source: null,
    raf: 0,
    objectUrl: null,
    generation: 0,
  }
  return engine
}

function attachGraph(e: Engine): void {
  if (e.ctx && e.source) return
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  const ctx = new AC()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.62
  const source = ctx.createMediaElementSource(e.audio)
  source.connect(analyser)
  analyser.connect(ctx.destination)
  e.ctx = ctx
  e.analyser = analyser
  e.source = source
}

function releaseObjectUrl(e: Engine): void {
  if (e.objectUrl) {
    URL.revokeObjectURL(e.objectUrl)
    e.objectUrl = null
  }
}

function stopLevels(e: Engine): void {
  if (e.raf) {
    cancelAnimationFrame(e.raf)
    e.raf = 0
  }
}

export function stopSaraSpeech(): void {
  if (!engine) return
  engine.generation += 1
  stopLevels(engine)
  try {
    engine.audio.pause()
    engine.audio.removeAttribute('src')
    engine.audio.load()
  } catch {
    /* ignore */
  }
  releaseObjectUrl(engine)
}

/** Call from a tap (Send / Play). iOS only unlocks audio inside a user gesture. */
export function unlockSaraSpeech(): void {
  if (!isVoiceReady()) return
  const e = ensureEngine()
  try {
    attachGraph(e)
    if (e.ctx?.state === 'suspended') void e.ctx.resume()
    e.audio.muted = true
    e.audio.src = SILENT_WAV
    void e.audio.play().then(() => {
      e.audio.pause()
      e.audio.muted = false
    }).catch(() => {
      e.audio.muted = false
    })
  } catch {
    /* ignore */
  }
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

function visemePulse(elapsed: number, duration: number): number {
  if (duration <= 0) return 0
  const t = elapsed / duration
  const envelope = t < 0.08 ? t / 0.08 : t > 0.9 ? Math.max(0, (1 - t) / 0.1) : 1
  const syllable = 0.42 + 0.58 * Math.abs(Math.sin(elapsed * 11.2)) * (0.55 + 0.45 * Math.abs(Math.sin(elapsed * 4.1)))
  return Math.min(1, envelope * syllable)
}

export async function fetchSaraSpeech(text: string): Promise<Blob | null> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(`${apiBase()}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ text: clean }),
    })
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

export async function requestSaraTalk(text: string): Promise<string | null> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 55_000)
  try {
    const res = await fetch(`${apiBase()}/talk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ text: clean }),
    })
    const data = (await res.json().catch(() => ({}))) as { videoUrl?: string | null }
    return data.videoUrl || null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

type SpeakOpts = {
  onStart?: () => void
  onEnd?: () => void
  onLevel?: (level: number) => void
  onError?: (message: string) => void
}

export async function speakSara(text: string, opts: SpeakOpts = {}): Promise<void> {
  if (!isVoiceReady() || isSaraMuted()) {
    opts.onEnd?.()
    return
  }
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) {
    opts.onEnd?.()
    return
  }

  const e = ensureEngine()
  e.generation += 1
  const gen = e.generation
  stopLevels(e)

  const blob = await fetchSaraSpeech(clean)
  if (gen !== e.generation) return
  if (!blob) {
    opts.onError?.(SARA_VOICE_OFFLINE)
    opts.onEnd?.()
    return
  }

  try {
    attachGraph(e)
    if (e.ctx?.state === 'suspended') await e.ctx.resume()
  } catch {
    /* play without analyser */
  }

  releaseObjectUrl(e)
  const url = URL.createObjectURL(blob)
  e.objectUrl = url
  e.audio.muted = false
  e.audio.src = url

  const startedAt = performance.now()

  const tick = () => {
    if (gen !== e.generation) {
      opts.onLevel?.(0)
      return
    }
    const duration = e.audio.duration && Number.isFinite(e.audio.duration) ? e.audio.duration : 0
    const elapsed = (performance.now() - startedAt) / 1000
    let level = visemePulse(elapsed, duration || Math.max(elapsed + 0.4, 1.2))
    if (e.analyser) {
      const rms = rmsLevel(e.analyser)
      if (rms > 0.012) level = Math.min(1, rms * 7.2)
    }
    opts.onLevel?.(level)
    e.raf = requestAnimationFrame(tick)
  }

  const finish = () => {
    if (gen !== e.generation) return
    stopLevels(e)
    opts.onLevel?.(0)
    opts.onEnd?.()
  }

  e.audio.onended = finish
  e.audio.onerror = finish

  try {
    await e.audio.play()
    if (gen !== e.generation) return
    opts.onStart?.()
    e.raf = requestAnimationFrame(tick)
  } catch {
    opts.onError?.(SARA_VOICE_OFFLINE)
    finish()
  }
}
