/** D-ID Agents SDK (WebRTC). Credentials come from POST /stream — never the server API key. */

function apiBase(): string {
  return (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
}

export type SaraStreamCreds = {
  agentId: string
  clientKey: string
  expiresAt?: number | null
}

type AgentManagerLike = {
  connect: () => Promise<unknown>
  disconnect: () => Promise<unknown>
  speak: (script: { type: 'text'; input: string }) => Promise<unknown>
  interrupt?: (arg?: unknown) => unknown
  getIsInterruptAvailable?: () => boolean
}

type StreamCallbacks = {
  onTalking?: (talking: boolean) => void
  onReady?: (ready: boolean) => void
}

/** Speak-only. Skips D-ID chat/LLM so Grok stays the brain. */
const SPEAK_MODE = 'DirectPlayback'

/** Modes where the SDK no-ops speak() or tears down streamingManager. */
const DEAD_MODES = new Set(['TextOnly', 'Playground', 'Maintenance', 'Off'])

const PLAY_RETRY_MS = [0, 50, 200, 500, 1200, 3000]

let videoEl: HTMLVideoElement | null = null
let srcObject: MediaStream | null = null
let manager: AgentManagerLike | null = null
let connectPromise: Promise<boolean> | null = null
let speakGen = 0
let sessionGen = 0
let streamReady = false
let deadMode = false
let foregroundBound = false
const playTimers = new Set<number>()
const listeners: StreamCallbacks = {}

/**
 * The PNG still stays up unless the <video> itself has a srcObject AND
 * decoded frames. streamReady (module flag / SDK callback) is not enough:
 * Chromium on PR8 hid the still at opacity 0 while video.srcObject was
 * null and D-ID /streams 403'd — a blank sage circle. Ara-only must not
 * lift the PNG. Do not wait on D-ID START (iOS often never fires it).
 */
export function shouldShowSaraStream(opts: {
  streamReady: boolean
  speaking?: boolean
  streamTalking?: boolean
  videoLive?: boolean
}): boolean {
  return Boolean(opts.videoLive)
}

/** True only when the element holds a real stream with a decoded frame. */
export function isSaraVideoLive(video: HTMLVideoElement | null | undefined): boolean {
  if (!video || !video.srcObject) return false
  return video.videoWidth > 0
}

function elementHoldsStream(): boolean {
  return Boolean(videoEl?.srcObject)
}

function logStream(event: string, detail?: unknown) {
  try {
    console.info('[sara-stream]', event, detail ?? '')
  } catch {
    /* ignore */
  }
}

function describeError(error: unknown): string {
  const err = error as { status?: number; kind?: string; message?: string } | undefined
  const raw = `${err?.kind || ''} ${err?.status ?? ''} ${err?.message || error || ''}`.trim()
  return raw.replace(/ck_[A-Za-z0-9_-]+/g, 'ck_[redacted]').slice(0, 180)
}

function primeVideo(video: HTMLVideoElement) {
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.playsInline = true
  video.autoplay = true
  video.muted = true
  video.defaultMuted = true
  video.setAttribute('muted', '')
  video.volume = 0
}

function setReady(next: boolean) {
  streamReady = next
  listeners.onReady?.(next)
}

function clearPlayTimers() {
  playTimers.forEach((id) => window.clearTimeout(id))
  playTimers.clear()
}

function schedulePlay(video: HTMLVideoElement) {
  primeVideo(video)
  const kick = () => {
    if (videoEl !== video) return
    video.muted = true
    video.playsInline = true
    const play = video.play()
    if (play && typeof play.catch === 'function') void play.catch(() => {})
  }
  clearPlayTimers()
  kick()
  PLAY_RETRY_MS.forEach((ms) => {
    if (ms === 0) return
    playTimers.add(window.setTimeout(kick, ms))
  })
}

function attachSrcObject(stream: MediaStream | null) {
  srcObject = stream
  if (!videoEl) {
    // Never mark ready until the <video> node actually holds the stream.
    setReady(false)
    return
  }
  primeVideo(videoEl)
  if (stream) {
    if (videoEl.src) videoEl.src = ''
    if (videoEl.srcObject !== stream) videoEl.srcObject = stream
    schedulePlay(videoEl)
  } else {
    clearPlayTimers()
    try {
      videoEl.srcObject = null
    } catch {
      /* ignore */
    }
  }
  setReady(elementHoldsStream())
}

function fallBackToStill(reason: string, detail?: unknown) {
  logStream(reason, detail)
  setReady(false)
  if (srcObject || videoEl?.srcObject) attachSrcObject(null)
}

function bindForegroundReplay() {
  if (foregroundBound || typeof window === 'undefined') return
  foregroundBound = true
  const replay = () => {
    if (srcObject && videoEl) schedulePlay(videoEl)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') replay()
  })
  window.addEventListener('pageshow', replay)
}

function dropManager() {
  sessionGen += 1
  const current = manager
  manager = null
  connectPromise = null
  deadMode = false
  if (current) {
    try {
      void current.disconnect()
    } catch {
      /* ignore */
    }
  }
}

export function bindSaraStreamVideo(el: HTMLVideoElement | null) {
  videoEl = el
  bindForegroundReplay()
  if (el) {
    attachSrcObject(srcObject)
    return
  }
  // Video node gone (StrictMode remount, leave page) — do not leave streamReady
  // true or the still stays at opacity 0 over an empty sage circle.
  setReady(false)
}

/** Call from Send / Play — same user-gesture window as ara unlock. */
export function unlockSaraStream(): void {
  if (!videoEl) return
  primeVideo(videoEl)
  if (srcObject && videoEl.srcObject !== srcObject) {
    if (videoEl.src) videoEl.src = ''
    videoEl.srcObject = srcObject
  }
  schedulePlay(videoEl)
}

export function setSaraStreamCallbacks(next: StreamCallbacks) {
  listeners.onTalking = next.onTalking
  listeners.onReady = next.onReady
  if (next.onReady) next.onReady(streamReady)
}

export async function fetchSaraStreamCreds(): Promise<SaraStreamCreds | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`${apiBase()}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: '{}',
    })
    const data = (await res.json().catch(() => ({}))) as {
      agentId?: string | null
      clientKey?: string | null
      expiresAt?: number | null
    }
    if (!data.agentId || !data.clientKey) return null
    return { agentId: data.agentId, clientKey: data.clientKey, expiresAt: data.expiresAt }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

async function loadSdk() {
  const mod = (await import('@d-id/client-sdk')) as {
    createAgentManager?: (id: string, opts: unknown) => Promise<AgentManagerLike>
    default?: { createAgentManager?: (id: string, opts: unknown) => Promise<AgentManagerLike> }
  }
  return mod.createAgentManager || mod.default?.createAgentManager || null
}

function markDeadFromError(error: unknown) {
  const err = error as { message?: string; kind?: string; status?: number } | undefined
  const blob = `${err?.kind || ''} ${err?.message || error || ''}`
  if (/TextOnly|Playground|Maintenance|downgrad/i.test(blob)) deadMode = true
}

function isTransientStreamError(error: unknown): boolean {
  const err = error as { status?: number; kind?: string; message?: string } | undefined
  const status = Number(err?.status)
  const blob = `${err?.kind || ''} ${err?.message || error || ''}`
  return status === 403 || /403|PermissionError|AuthorizationError/i.test(blob)
}

function speakLooksDead(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const row = result as { video_id?: unknown; duration?: unknown; status?: unknown }
  const videoId = String(row.video_id ?? '')
  const duration = Number(row.duration)
  return row.status === 'success' && !videoId && (duration === 0 || Number.isNaN(duration))
}

export async function connectSaraStream(): Promise<boolean> {
  if (manager && !deadMode && elementHoldsStream()) return true
  if (connectPromise) return connectPromise
  if (manager) dropManager()
  const session = ++sessionGen
  connectPromise = (async () => {
    deadMode = false
    const creds = await fetchSaraStreamCreds()
    if (!creds || session !== sessionGen) {
      logStream('no stream credentials — keeping still')
      return false
    }
    const create = await loadSdk()
    if (!create || session !== sessionGen) return false
    const created = await create(creds.agentId, {
      auth: { type: 'key', clientKey: creds.clientKey },
      mode: SPEAK_MODE,
      enableAnalytics: false,
      streamOptions: {
        compatibilityMode: 'on',
        // iOS often never decodes warmup; gating connect() on that leaves speak() dead.
        streamWarmup: false,
        outputResolution: 512,
      },
      callbacks: {
        onSrcObjectReady(value: MediaStream) {
          attachSrcObject(value)
          return value
        },
        onVideoStateChange(state: string) {
          const talking = String(state).toUpperCase() !== 'STOP'
          if (srcObject && videoEl) schedulePlay(videoEl)
          listeners.onTalking?.(talking)
        },
        onConnectionStateChange(state: string) {
          const s = String(state).toLowerCase()
          if (s === 'connected' && srcObject) {
            attachSrcObject(srcObject)
          }
          // Early D-ID /streams 403 retries emit fail/disconnected. Keep the
          // still up unless the <video> actually holds a stream.
          if ((s === 'fail' || s === 'disconnected' || s === 'closed') && !elementHoldsStream()) {
            logStream('peer has no video srcObject — keeping still', s)
            setReady(false)
          }
        },
        onModeChange(mode: string) {
          if (DEAD_MODES.has(String(mode))) deadMode = true
        },
        onError(error: Error) {
          if (isTransientStreamError(error)) {
            if (!elementHoldsStream()) {
              logStream('D-ID /streams 403 — keeping still; ara continues', describeError(error))
              setReady(false)
            }
            return
          }
          logStream('stream error', describeError(error))
          markDeadFromError(error)
        },
      },
    })
    if (session !== sessionGen) {
      try {
        void created.disconnect()
      } catch {
        /* superseded */
      }
      return false
    }
    manager = created
    await created.connect()
    if (session !== sessionGen || deadMode) return false
    if (srcObject) attachSrcObject(srcObject)
    if (!elementHoldsStream()) {
      logStream('connect finished with no video srcObject — keeping still')
      return false
    }
    return true
  })().catch((error) => {
    const transient = isTransientStreamError(error)
    if (transient && session === sessionGen && elementHoldsStream() && !deadMode) {
      logStream('transient 403 after srcObject attached — keeping stream')
      return true
    }
    logStream(
      transient ? 'D-ID /streams 403 after retries — keeping still; ara continues' : 'connect failed — keeping still',
      describeError(error),
    )
    return false
  })
  const ok = await connectPromise
  connectPromise = null
  if (!ok && session === sessionGen) {
    dropManager()
    fallBackToStill('stream unavailable — still stays visible')
  }
  return ok
}

export async function speakSaraStream(text: string): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return
  const gen = ++speakGen

  const attempt = async () => {
    const ok = await connectSaraStream()
    if (!ok || gen !== speakGen || !manager || deadMode) return
    unlockSaraStream()
    const result = await manager.speak({ type: 'text', input: clean })
    unlockSaraStream()
    if (speakLooksDead(result)) {
      deadMode = true
      throw new Error('D-ID speak no-op')
    }
  }

  try {
    await attempt()
  } catch (error) {
    if (isTransientStreamError(error)) {
      logStream('speak 403 — ara continues; still stays unless video is live', describeError(error))
      if (gen !== speakGen) return
      try {
        await attempt()
      } catch (retryError) {
        if (!elementHoldsStream()) fallBackToStill('speak 403 retries exhausted', describeError(retryError))
      }
      return
    }
    markDeadFromError(error)
    if (gen !== speakGen) return
    dropManager()
    try {
      await attempt()
    } catch {
      /* ara audio still plays; motion is best-effort */
    }
  }
}

export function stopSaraStream(): void {
  speakGen += 1
  listeners.onTalking?.(false)
  try {
    if (manager?.getIsInterruptAvailable?.()) {
      manager.interrupt?.({ type: 'manual' })
    }
  } catch {
    /* Talks V2 agents do not support interrupt */
  }
}

export function disconnectSaraStream(): void {
  stopSaraStream()
  dropManager()
  attachSrcObject(null)
}
