/** D-ID Agents SDK (WebRTC). Credentials come from POST /stream — never the server API key.
 * Live POST /agents/{id}/streams 403 `{ kind: "Forbidden", description: "Max user sessions reached" }`
 * means the trial/session cap (or zero credits) — do not retry connect/speak; keep still + ara.
 *
 * Do not connect() on Ask Sara mount. Lite’s concurrent stream cap is small; idle
 * tabs (phone + laptop PWA + Studio) exhaust it and freeze the still. Mint + WebRTC
 * start on Send / Play, in parallel with Grok. Keep the session after connect
 * so the next speak() does not re-pay WebRTC; release on leave / unmount / pagehide.
 * speak() fires as soon as Grok text exists — do not wait for ara, and do
 * not start ara while D-ID is still connecting or decoding. Heard voice is
 * D-ID stream audio only when speak has started AND the <video> has visible
 * playing frames; unmute / enable audio tracks in that same moment so audio
 * cannot lead the mouth. If connect/speak fails, is capped, or a longer
 * budget elapses with no playable AV, fall back to ara + still (or muted
 * video if frames exist without audio). streamWarmup stays off so iOS does
 * not gate speak() on a warmup decode.
 */

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

export type SaraStreamStatus = 'live' | 'unavailable' | 'session_capped'
export type SaraStreamSpeakResult = 'heard' | 'fallback'
export type SaraStreamVoicePath = 'idle' | 'pending' | 'did' | 'ara'

type StreamCallbacks = {
  onTalking?: (talking: boolean) => void
  onReady?: (ready: boolean) => void
  onStatus?: (status: SaraStreamStatus) => void
}

/** Quiet UI line when D-ID is at the session/credit cap. Ara still plays. */
export const SARA_STREAM_CAPPED_NOTE = "I'll keep talking. The portrait stays still for now."

/** After speak() is sent, wait this long for playable AV before ara. */
export const STREAM_AV_READY_MS = 8000

/** Heard D-ID audio only when the stream is the voice path AND frames are on screen. */
export function streamVideoShouldBeMuted(opts: {
  voicePath: SaraStreamVoicePath
  userMuted: boolean
  videoLive?: boolean
}): boolean {
  if (opts.userMuted) return true
  return !(opts.voicePath === 'did' && opts.videoLive)
}

/** iOS: keep the element unlocked after Send/Play so a later unmute can play. */
export function streamVideoShouldUnlockElement(opts: {
  voicePath: SaraStreamVoicePath
  userMuted: boolean
}): boolean {
  if (opts.userMuted) return false
  return opts.voicePath === 'pending' || opts.voicePath === 'did'
}

/** Speak-only. Skips D-ID chat/LLM so Grok stays the brain. */
const SPEAK_MODE = 'DirectPlayback'

/** Modes where the SDK no-ops speak() or tears down streamingManager. */
const DEAD_MODES = new Set(['TextOnly', 'Playground', 'Maintenance', 'Off'])

const PLAY_RETRY_MS = [0, 50, 200, 500, 1200, 3000]
/** Delay so React StrictMode remount reuses the in-flight session instead of burning a slot. */
const RELEASE_MS = 400

let videoEl: HTMLVideoElement | null = null
let srcObject: MediaStream | null = null
let manager: AgentManagerLike | null = null
let connectPromise: Promise<boolean> | null = null
let sdkPromise: Promise<((id: string, opts: unknown) => Promise<AgentManagerLike>) | null> | null = null
let speakGen = 0
let sessionGen = 0
let streamReady = false
let deadMode = false
/** D-ID 403 Forbidden / Max user sessions — do not retry; retries hold sessions. */
let sessionCapped = false
let foregroundBound = false
let lifecycleBound = false
/** True after Send / Play asks for a session. Idle mount does not set this. */
let streamWanted = false
let releaseTimer: number | null = null
const playTimers = new Set<number>()
const listeners: StreamCallbacks = {}
/** Heard-voice state. did + live frames unmute; pending stays silent; ara remutes. */
let voicePath: SaraStreamVoicePath = 'idle'
let fallbackLocked = false
/** Speak START / a real speak result — not enough to unmute without frames. */
let speakingStarted = false
/** Ask Sara mute preference — kept here so this module does not import speakSara. */
let userMuted = false
const avReadyWaiters: Array<(ready: boolean) => void> = []
const talkingEndTimers = new Set<number>()
const AV_CUE_EVENTS = ['loadedmetadata', 'loadeddata', 'playing', 'resize'] as const
let avCueVideo: HTMLVideoElement | null = null

export function setSaraStreamUserMuted(muted: boolean): void {
  userMuted = muted
  if (videoEl) applyHeardMute(videoEl)
}

function hasLiveManager(): boolean {
  return Boolean(manager && !deadMode && !sessionCapped)
}

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

function streamHasLiveFrames(): boolean {
  if (!isSaraVideoLive(videoEl) || !videoEl) return false
  if (videoEl.paused) return false
  return videoEl.readyState >= 2
}

function gateAudioTracks(enabled: boolean) {
  const stream = srcObject || (videoEl?.srcObject instanceof MediaStream ? videoEl.srcObject : null)
  if (!stream || typeof stream.getAudioTracks !== 'function') return
  stream.getAudioTracks().forEach((track) => {
    track.enabled = enabled
  })
}

function applyHeardMute(video: HTMLVideoElement) {
  const videoLive = isSaraVideoLive(video)
  const audible = !streamVideoShouldBeMuted({ voicePath, userMuted, videoLive })
  const unlocked = streamVideoShouldUnlockElement({ voicePath, userMuted })
  // Disable tracks first so a pending unlock cannot leak audio before frames.
  gateAudioTracks(audible)
  if (audible) {
    video.muted = false
    video.defaultMuted = false
    video.removeAttribute('muted')
    video.volume = 1
    return
  }
  video.volume = 0
  if (unlocked) {
    // iOS often ignores volume; unlocked + disabled tracks stay silent until promote.
    video.muted = false
    video.defaultMuted = false
    video.removeAttribute('muted')
    return
  }
  video.muted = true
  video.defaultMuted = true
  video.setAttribute('muted', '')
}

function setVoicePath(next: SaraStreamVoicePath) {
  voicePath = next
  if (next === 'ara') fallbackLocked = true
  if (next === 'idle' || next === 'pending') fallbackLocked = false
  if (next === 'idle' || next === 'ara') speakingStarted = false
  if (videoEl) applyHeardMute(videoEl)
}

function resolveAvReady(ready: boolean) {
  const waiters = avReadyWaiters.splice(0, avReadyWaiters.length)
  waiters.forEach((fn) => fn(ready))
}

function maybePromoteHeard() {
  if (fallbackLocked) return
  if (voicePath !== 'pending' && voicePath !== 'did') return
  if (!speakingStarted || !streamHasLiveFrames()) {
    if (videoEl) applyHeardMute(videoEl)
    return
  }
  setVoicePath('did')
  if (videoEl) {
    applyHeardMute(videoEl)
    schedulePlay(videoEl)
  }
  listeners.onTalking?.(true)
  resolveAvReady(true)
}

function waitForAvReady(ms: number): Promise<boolean> {
  if (voicePath === 'did' && speakingStarted && streamHasLiveFrames()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      window.clearTimeout(timer)
      const idx = avReadyWaiters.indexOf(onReady)
      if (idx >= 0) avReadyWaiters.splice(idx, 1)
      resolve(ready)
    }
    const onReady = (ready: boolean) => finish(ready)
    const timer = window.setTimeout(() => finish(false), ms)
    avReadyWaiters.push(onReady)
  })
}

function onAvCue() {
  maybePromoteHeard()
}

function bindAvCues(video: HTMLVideoElement | null) {
  if (avCueVideo === video) return
  if (avCueVideo) {
    AV_CUE_EVENTS.forEach((event) => avCueVideo?.removeEventListener(event, onAvCue))
  }
  avCueVideo = video
  if (video) {
    AV_CUE_EVENTS.forEach((event) => video.addEventListener(event, onAvCue))
  }
}

function clearTalkingEndTimers() {
  talkingEndTimers.forEach((id) => window.clearTimeout(id))
  talkingEndTimers.clear()
}

function scheduleTalkingEnd(result: unknown, gen: number) {
  const duration = Number((result as { duration?: unknown } | undefined)?.duration)
  if (!Number.isFinite(duration) || duration <= 0) return
  talkingEndTimers.add(
    window.setTimeout(() => {
      if (gen !== speakGen) return
      listeners.onTalking?.(false)
      if (voicePath === 'did') setVoicePath('idle')
    }, Math.round(duration * 1000) + 250),
  )
}

function speakHasVideo(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const row = result as { video_id?: unknown; duration?: unknown; status?: unknown }
  const videoId = String(row.video_id ?? '')
  const duration = Number(row.duration)
  if (videoId) return true
  return row.status === 'success' && Number.isFinite(duration) && duration > 0
}

function primeVideo(video: HTMLVideoElement) {
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.playsInline = true
  video.autoplay = true
  applyHeardMute(video)
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
    applyHeardMute(video)
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
  bindAvCues(videoEl)
  primeVideo(videoEl)
  if (stream) {
    if (videoEl.src) videoEl.src = ''
    if (videoEl.srcObject !== stream) videoEl.srcObject = stream
    // Keep audio tracks off until speak + visible frames, even if the element is unlocked.
    applyHeardMute(videoEl)
    schedulePlay(videoEl)
    maybePromoteHeard()
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

function safeDisconnect(agent: AgentManagerLike | null) {
  if (!agent) return
  try {
    void agent.disconnect()
  } catch {
    /* already closed */
  }
}

function dropManager() {
  sessionGen += 1
  const current = manager
  manager = null
  connectPromise = null
  // Keep sessionCapped. Clearing it would reconnect and leak more D-ID sessions.
  if (!sessionCapped) deadMode = false
  safeDisconnect(current)
}

function cancelRelease() {
  if (releaseTimer == null) return
  window.clearTimeout(releaseTimer)
  releaseTimer = null
}

/** Tear down the WebRTC peer now. */
function dropLiveSession() {
  cancelRelease()
  stopSaraStream()
  dropManager()
  attachSrcObject(null)
}

function bindSessionLifecycle() {
  if (lifecycleBound || typeof window === 'undefined') return
  lifecycleBound = true
  window.addEventListener('pagehide', () => {
    logStream('pagehide — releasing D-ID session')
    streamWanted = false
    dropLiveSession()
  })
}

/** Load the Agents SDK only. Does not mint or open WebRTC — idle Ask Sara must not hold a Lite slot. */
export function preloadSaraStream(): void {
  bindSessionLifecycle()
  void loadSdk()
}

/** Debounced disconnect for React unmount. StrictMode remount cancels this and reuses the session. */
export function releaseSaraStream(): void {
  streamWanted = false
  bindSessionLifecycle()
  cancelRelease()
  if (typeof window === 'undefined') {
    dropLiveSession()
    return
  }
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null
    if (!streamWanted) dropLiveSession()
  }, RELEASE_MS)
}

export function bindSaraStreamVideo(el: HTMLVideoElement | null) {
  videoEl = el
  bindForegroundReplay()
  bindAvCues(el)
  if (el) {
    attachSrcObject(srcObject)
    return
  }
  // Video node gone (StrictMode remount, leave page) — do not leave streamReady
  // true or the still stays at opacity 0 over an empty sage circle.
  setReady(false)
}

/** Call from Send / Play — same user-gesture window as ara unlock.
 * Unlocks the element (iOS) but keeps D-ID audio silent until frames + speak.
 */
export function unlockSaraStream(): void {
  if (voicePath === 'idle') setVoicePath('pending')
  if (!videoEl) return
  bindAvCues(videoEl)
  primeVideo(videoEl)
  if (srcObject && videoEl.srcObject !== srcObject) {
    if (videoEl.src) videoEl.src = ''
    videoEl.srcObject = srcObject
  }
  applyHeardMute(videoEl)
  schedulePlay(videoEl)
  maybePromoteHeard()
}

/** Portrait play() retries — do not force muted; mute follows voicePath. */
export function replaySaraStreamVideo(): void {
  if (videoEl) schedulePlay(videoEl)
}

/** Remute after an unreachable Grok reply or when ara takes over. */
export function settleSaraStreamVoice(path: Exclude<SaraStreamVoicePath, 'pending' | 'did'>): void {
  setVoicePath(path)
  if (videoEl) applyHeardMute(videoEl)
}

export function setSaraStreamCallbacks(next: StreamCallbacks) {
  listeners.onTalking = next.onTalking
  listeners.onReady = next.onReady
  listeners.onStatus = next.onStatus
  if (next.onReady) next.onReady(streamReady)
  if (next.onStatus && sessionCapped) next.onStatus('session_capped')
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
  if (!sdkPromise) {
    sdkPromise = import('@d-id/client-sdk')
      .then((mod) => {
        const sdk = mod as {
          createAgentManager?: (id: string, opts: unknown) => Promise<AgentManagerLike>
          default?: { createAgentManager?: (id: string, opts: unknown) => Promise<AgentManagerLike> }
        }
        return sdk.createAgentManager || sdk.default?.createAgentManager || null
      })
      .catch(() => null)
  }
  return sdkPromise
}

function markDeadFromError(error: unknown) {
  const err = error as { message?: string; kind?: string; status?: number } | undefined
  const blob = `${err?.kind || ''} ${err?.message || error || ''}`
  if (/TextOnly|Playground|Maintenance|downgrad/i.test(blob)) deadMode = true
}

function errorBlob(error: unknown): string {
  const err = error as { kind?: string; message?: string } | undefined
  return `${err?.kind || ''} ${err?.message || error || ''}`
}

/**
 * D-ID POST /agents/{id}/streams 403 { kind: "Forbidden", description: "Max user sessions reached" }.
 * Also 402 InsufficientCredits. Do not retry — retries hold sessions and worsen the cap.
 * Worker mint / Origin / agent id are not this error.
 */
export function isSaraSessionCapError(error: unknown): boolean {
  const err = error as { kind?: string; message?: string } | undefined
  const blob = errorBlob(error)
  if (/Max user sessions reached/i.test(blob)) return true
  if (/InsufficientCredits/i.test(blob)) return true
  return err?.kind === 'Forbidden' || /^\s*Forbidden\b/i.test(blob)
}

/** Early origin/auth 403s the SDK retries. Session-cap Forbidden is not transient. */
export function isTransientStreamError(error: unknown): boolean {
  if (isSaraSessionCapError(error)) return false
  const err = error as { status?: number; kind?: string; message?: string } | undefined
  const status = Number(err?.status)
  const blob = errorBlob(error)
  return status === 403 || /403|PermissionError|AuthorizationError/i.test(blob)
}

function markSessionCapped(error?: unknown) {
  sessionCapped = true
  deadMode = true
  logStream(
    'D-ID session cap — not retrying (retries hold sessions); still + ara',
    error ? describeError(error) : '',
  )
  listeners.onStatus?.('session_capped')
  setReady(false)
}

function speakLooksDead(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const row = result as { video_id?: unknown; duration?: unknown; status?: unknown }
  const videoId = String(row.video_id ?? '')
  const duration = Number(row.duration)
  return row.status === 'success' && !videoId && (duration === 0 || Number.isNaN(duration))
}

export async function connectSaraStream(): Promise<boolean> {
  streamWanted = true
  cancelRelease()
  bindSessionLifecycle()
  if (sessionCapped) {
    logStream('D-ID session cap — not retrying; still + ara')
    listeners.onStatus?.('session_capped')
    return false
  }
  // Reuse a live manager even before the <video> has a srcObject.
  // streamWarmup is off; frames arrive on speak(). Dropping here re-pays connect (~2s).
  if (hasLiveManager()) return true
  if (connectPromise) return connectPromise
  if (manager) dropManager()
  const session = ++sessionGen
  connectPromise = (async () => {
    let created: AgentManagerLike | null = null
    let keepSession = false
    try {
      if (sessionCapped) {
        listeners.onStatus?.('session_capped')
        return false
      }
      deadMode = false
      const [creds, create] = await Promise.all([fetchSaraStreamCreds(), loadSdk()])
      if (!creds || session !== sessionGen) {
        logStream('no stream credentials — keeping still')
        return false
      }
      if (!create || session !== sessionGen) return false
      created = await create(creds.agentId, {
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
            if (elementHoldsStream() && !sessionCapped) listeners.onStatus?.('live')
            return value
          },
          onVideoStateChange(state: string) {
            const talking = String(state).toUpperCase() !== 'STOP'
            if (talking) {
              speakingStarted = true
              // Do not unmute on START alone — wait for decoded frames.
              maybePromoteHeard()
            }
            if (srcObject && videoEl) schedulePlay(videoEl)
            listeners.onTalking?.(talking)
            if (!talking) {
              speakingStarted = false
              if (voicePath === 'did') setVoicePath('idle')
            }
          },
          onFirstAudioDetected() {
            // Audio packets can arrive seconds before the first painted frame.
            // Keep tracks gated until maybePromoteHeard sees live video.
            logStream('first audio detected — holding mute until video frames')
            if (videoEl) applyHeardMute(videoEl)
            maybePromoteHeard()
          },
          onConnectionStateChange(state: string) {
            const s = String(state).toLowerCase()
            if (s === 'connected' && srcObject) {
              attachSrcObject(srcObject)
            }
            if (s === 'fail' || s === 'closed') {
              logStream('peer closed — will reconnect on next speak', s)
              deadMode = true
              setReady(false)
            } else if (s === 'disconnected' && !elementHoldsStream()) {
              logStream('peer has no video srcObject — keeping still', s)
              setReady(false)
            }
          },
          onModeChange(mode: string) {
            if (DEAD_MODES.has(String(mode))) deadMode = true
          },
          onError(error: Error) {
            if (isSaraSessionCapError(error)) {
              markSessionCapped(error)
              return
            }
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
      if (session !== sessionGen || sessionCapped) return false
      manager = created
      await created.connect()
      if (session !== sessionGen || deadMode || sessionCapped) return false
      if (srcObject) attachSrcObject(srcObject)
      // Keep the session without frames. Warmup is off; speak() attaches the talking track.
      if (!elementHoldsStream()) {
        logStream('connected — no video frames yet; session kept for speak()')
      } else {
        listeners.onStatus?.('live')
      }
      keepSession = true
      return true
    } catch (error) {
      if (isSaraSessionCapError(error)) {
        markSessionCapped(error)
        return false
      }
      const transient = isTransientStreamError(error)
      if (transient && session === sessionGen && elementHoldsStream() && !deadMode && !sessionCapped) {
        logStream('transient 403 after srcObject attached — keeping stream')
        keepSession = true
        return true
      }
      logStream(
        transient ? 'D-ID /streams 403 after retries — keeping still; ara continues' : 'connect failed — keeping still',
        describeError(error),
      )
      listeners.onStatus?.('unavailable')
      return false
    } finally {
      // Failed or superseded connect must release the D-ID session so we do not leak slots.
      if (!keepSession && created) {
        if (manager === created) manager = null
        safeDisconnect(created)
      }
    }
  })()
  const ok = await connectPromise
  connectPromise = null
  if (!ok && session === sessionGen) {
    dropManager()
    fallBackToStill('stream unavailable — still stays visible')
  }
  return ok
}

function markHeard(result: unknown, gen: number): SaraStreamSpeakResult {
  if (gen !== speakGen || fallbackLocked) return 'fallback'
  speakingStarted = true
  maybePromoteHeard()
  if (voicePath !== 'did' || !streamHasLiveFrames()) return 'fallback'
  scheduleTalkingEnd(result, gen)
  logStream('D-ID stream audio is the heard voice — skipping ara')
  return 'heard'
}

function markVoiceFallback(reason: string, detail?: unknown): SaraStreamSpeakResult {
  setVoicePath('ara')
  if (videoEl) applyHeardMute(videoEl)
  logStream(reason, detail)
  return 'fallback'
}

export async function speakSaraStream(text: string): Promise<SaraStreamSpeakResult> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'fallback'
  if (sessionCapped) {
    listeners.onStatus?.('session_capped')
    return markVoiceFallback('D-ID session cap — not retrying; still + ara')
  }
  const gen = ++speakGen
  fallbackLocked = false
  speakingStarted = false
  setVoicePath('pending')
  clearTalkingEndTimers()

  const attempt = async (): Promise<SaraStreamSpeakResult> => {
    // Join the Send/Play connect. Do not start ara while D-ID is still coming up.
    const ok = await connectSaraStream()
    if (!ok || gen !== speakGen || !manager || deadMode || sessionCapped) return 'fallback'
    unlockSaraStream()
    const avReady = waitForAvReady(STREAM_AV_READY_MS)
    const speakPromise = manager.speak({ type: 'text', input: clean }).then((result) => {
      if (speakLooksDead(result)) {
        deadMode = true
        resolveAvReady(false)
        throw new Error('D-ID speak no-op')
      }
      if (speakHasVideo(result)) {
        speakingStarted = true
        maybePromoteHeard()
      }
      return result
    })
    unlockSaraStream()
    const first = await Promise.race([
      avReady.then((ready) => ({ kind: 'av' as const, ready })),
      speakPromise.then((result) => ({ kind: 'speak' as const, result })),
    ])
    if (gen !== speakGen || fallbackLocked) return 'fallback'
    if (first.kind === 'av' && first.ready) {
      return markHeard(null, gen)
    }
    if (first.kind === 'speak') {
      const ready = await avReady
      if (gen !== speakGen || fallbackLocked) return 'fallback'
      if (ready || (voicePath === 'did' && streamHasLiveFrames())) {
        return markHeard(first.result, gen)
      }
    }
    return 'fallback'
  }

  const runAttempts = async (): Promise<SaraStreamSpeakResult> => {
    try {
      return await attempt()
    } catch (error) {
      if (isSaraSessionCapError(error)) {
        markSessionCapped(error)
        if (!elementHoldsStream()) fallBackToStill('session cap — keeping still; ara continues', describeError(error))
        return 'fallback'
      }
      if (isTransientStreamError(error)) {
        logStream('speak 403 — ara continues; still stays unless video is live', describeError(error))
        if (gen !== speakGen || sessionCapped) return 'fallback'
        try {
          return await attempt()
        } catch (retryError) {
          if (isSaraSessionCapError(retryError)) {
            markSessionCapped(retryError)
          }
          if (!elementHoldsStream()) fallBackToStill('speak 403 retries exhausted', describeError(retryError))
          return 'fallback'
        }
      }
      markDeadFromError(error)
      if (gen !== speakGen || sessionCapped) return 'fallback'
      dropManager()
      try {
        return await attempt()
      } catch (retryError) {
        if (isSaraSessionCapError(retryError)) markSessionCapped(retryError)
        return 'fallback'
      }
    }
  }

  try {
    const outcome = await runAttempts()
    if (gen !== speakGen) return 'fallback'
    if (outcome === 'heard' && !fallbackLocked && streamHasLiveFrames()) return 'heard'
    return markVoiceFallback('stream voice unavailable — falling back to ara')
  } catch (error) {
    if (isSaraSessionCapError(error)) markSessionCapped(error)
    if (gen !== speakGen) return 'fallback'
    return markVoiceFallback('stream speak failed — falling back to ara', describeError(error))
  }
}

export function stopSaraStream(): void {
  speakGen += 1
  fallbackLocked = false
  speakingStarted = false
  avReadyWaiters.splice(0, avReadyWaiters.length).forEach((fn) => fn(false))
  clearTalkingEndTimers()
  setVoicePath('idle')
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
  streamWanted = false
  dropLiveSession()
}
