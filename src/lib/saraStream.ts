/** D-ID Agents SDK (WebRTC). Credentials come from POST /stream — never the server API key.
 * Live POST /agents/{id}/streams 403 `{ kind: "Forbidden", description: "Max user sessions reached" }`
 * means the trial/session cap (or zero credits) — do not retry connect/speak; keep still + ara.
 *
 * Do not connect() on Ask Sara mount. Lite’s concurrent stream cap is small; idle
 * tabs (phone + laptop PWA + Studio) exhaust it and freeze the still. Paid and
 * class passes mint + WebRTC on Send / Play, in parallel with Grok. The demo
 * pass is the exception: the landing and home screen warm one muted session
 * and Ask Sara reuses it (demoStreamSession). This module still does not connect
 * from preload. Keep the session after connect so the next speak() does not
 * re-pay WebRTC; release on leave / unmount / pagehide. The demo Worker lease
 * is not renewed — it expires on its TTL.
 * speak() fires as soon as Grok text exists — do not wait for ara, and do
 * not start ara while D-ID is still connecting or decoding. Heard voice is
 * D-ID stream audio only when speak has started AND the <video> has visible
 * playing frames; keep the element muted (so late play() can decode) until
 * that moment, then unmute / enable audio tracks together so audio cannot
 * lead the mouth. If connect/speak fails, is capped, srcObject never
 * attaches, or a short budget elapses with no playable AV, fall back to
 * ara + still (or muted video if frames exist without audio). Do not skip
 * ara after a false "heard". streamWarmup stays off so iOS does not gate
 * speak() on a warmup decode. D-ID SDP finalize 400 is SessionError
 * (missing session_id) — keep the 201 stream and re-attach srcObject after
 * the SDK retry; do not treat that flap as a dead session.
 */

import { currentSaraPass, isDemoPass } from './demoPass.ts'
import { rewritePfilatesForSpeech } from './pfilatesSpeech.mjs'
import { beginMutedGesturePlay, classifyPlayRejection, unmuteInPlace } from './saraStreamGesture.ts'

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
export type SaraStreamVoicePath = 'idle' | 'pending' | 'did' | 'ara' | 'visual'

type StreamCallbacks = {
  onTalking?: (talking: boolean) => void
  onReady?: (ready: boolean) => void
  onStatus?: (status: SaraStreamStatus) => void
  /** Fired when a previously-heard D-ID path dies and ara must take over. */
  onVoiceFallback?: () => void
  /** Muted play() from a tap was rejected. The face needs Tap to see Sara. */
  onSeeSara?: (blocked: boolean) => void
  /** In-place unmute succeeded (true) or the video must stay a muted visual (false). */
  onStreamAudible?: (ok: boolean) => void
}

/** Quiet UI line when D-ID is at the session/credit cap. Ara still plays. */
export const SARA_STREAM_CAPPED_NOTE = "I'll keep talking. The portrait stays still for now."

/** After speak() is sent, wait this long for srcObject before ara. */
export const STREAM_SRC_WAIT_MS = 3500

/** After speak(), if srcObject exists, wait this long for playable frames. */
export const STREAM_AV_READY_MS = 4500

/** Heard D-ID audio only when the stream is the voice path AND frames are on screen. */
export function streamVideoShouldBeMuted(opts: {
  voicePath: SaraStreamVoicePath
  userMuted: boolean
  videoLive?: boolean
}): boolean {
  if (opts.userMuted) return true
  if (opts.voicePath === 'visual') return true
  return !(opts.voicePath === 'did' && opts.videoLive)
}

/** Unlock (muted=false) only when D-ID is the heard path — pending stays muted so late play() can decode. */
export function streamVideoShouldUnlockElement(opts: {
  voicePath: SaraStreamVoicePath
  userMuted: boolean
}): boolean {
  if (opts.userMuted) return false
  return opts.voicePath === 'did'
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
/** True while this tab wants the WebRTC session kept. Demo warm sets it on open. */
let streamWanted = false
/** Last connect() returned false (cap, 429, or no credentials). */
let connectFailed = false
/** Worker 429/402/403 or did_unavailable. Not a retryable warm failure. */
let streamDenied = false
let releaseTimer: number | null = null
const playTimers = new Set<number>()
/** Bumped when a tap cancels queued play() retries. In-flight plays from an older token are ignored. */
let playToken = 0
/** At most one video.play() is in flight. Overlapping calls abort each other on iOS. */
let playPending = false
/** One collapsed retry to run when the in-flight play() settles. */
let playFollowUp: (() => void) | null = null
/** Ask Sara registers this so Tap to see Sara can reopen a retryable warm session. */
let reconnectForTap: (() => void) | null = null
const listeners: StreamCallbacks = {}
/** Heard-voice state. did + live frames unmute; pending stays silent; ara remutes. visual stays muted. */
let voicePath: SaraStreamVoicePath = 'idle'
let fallbackLocked = false
/**
 * iPhone WebRTC audio is silenced by the hardware Silent switch. When set,
 * live frames stay a muted visual and ara on the media element is the voice.
 */
let keepStreamMuted = false
/** Last video.play() outcome for ?debug=1. `played` or a DOMException name. */
let playLabel = '—'
/** ICE / peer connection state from the Agents SDK. */
let iceState = '—'
/** A media track has arrived on the WebRTC stream. */
let trackReceived = false
/** Why this visit left D-ID audio. Shown on the debug line. */
let fallbackReason = '—'
/** Ask Sara was opened or Send was tapped before the <video> mounted. */
let gestureArmed = false
/** The user asked the video to play. Background autoplay failures stay quiet. */
let userAskedToSee = false
let seeBlocked = false
/** Speak START / a real speak result — not enough to unmute without frames. */
let speakingStarted = false
/** Ask Sara mute preference — kept here so this module does not import speakSara. */
let userMuted = false
const avReadyWaiters: Array<(ready: boolean) => void> = []
const talkingEndTimers = new Set<number>()
const AV_CUE_EVENTS = ['loadedmetadata', 'loadeddata', 'playing', 'resize'] as const
let avCueVideo: HTMLVideoElement | null = null
/** session_id from stream/created — D-ID SDP finalize 400s without it. */
let streamSessionId: string | null = null
let didFetchPatched = false
const lateTrackStreams = new WeakSet<MediaStream>()

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
  if (video.videoWidth > 0) return true
  // iOS WebRTC can paint frames and advance currentTime while videoWidth is still 0.
  const currentTime = Number(video.currentTime)
  return video.readyState >= 2 && video.paused === false && currentTime > 0
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
  const audible = !streamVideoShouldBeMuted({ voicePath, userMuted, videoLive }) && !video.paused
  // Disable tracks first so a pending path cannot leak audio before frames.
  gateAudioTracks(audible)
  if (audible) {
    video.muted = false
    video.defaultMuted = false
    video.removeAttribute('muted')
    video.volume = 1
    return
  }
  // Keep muted until did+frames. Unmuted play() after async connect is blocked
  // by autoplay rules, so the <video> never decodes and srcObject looks dead.
  // A paused element stays muted: iOS rejects play() once muted is false.
  video.volume = 0
  video.muted = true
  video.defaultMuted = true
  video.setAttribute('muted', '')
}

export type SaraStreamDebugFacts = {
  play: string
  muted: boolean | null
  videoWidth: number
  readyState: number
  ice: string
  track: boolean
  fallback: string
}

export function saraStreamHasFrames(): boolean {
  return isSaraVideoLive(videoEl)
}

export function saraStreamDebugFacts(): SaraStreamDebugFacts {
  const video = videoEl
  return {
    play: playLabel,
    muted: video ? video.muted : null,
    videoWidth: video?.videoWidth ?? 0,
    readyState: video?.readyState ?? 0,
    ice: iceState,
    track: trackReceived,
    fallback: fallbackReason,
  }
}

export function noteStreamFallback(reason: string): void {
  fallbackReason = reason || '—'
  logStream('fallback', `${fallbackReason} ${JSON.stringify(saraStreamDebugFacts())}`)
}

function logFacts(event: string) {
  logStream(event, saraStreamDebugFacts())
}

function markSee(blocked: boolean) {
  if (seeBlocked === blocked) {
    if (blocked) listeners.onSeeSara?.(true)
    return
  }
  seeBlocked = blocked
  listeners.onSeeSara?.(blocked)
}

function noteTracks(stream: MediaStream | null | undefined) {
  if (!stream || typeof stream.getTracks !== 'function') return
  const tracks = stream.getTracks()
  if (!tracks.length) return
  if (!trackReceived) logStream('track', tracks.map((track) => track.kind).join(',') || 'yes')
  trackReceived = true
}

function rememberPlayError(error: unknown, fromGesture: boolean) {
  const decision = classifyPlayRejection(error)
  playLabel = decision.name
  logStream('video.play rejected', playLabel)
  // AbortError means a newer play() replaced this one. Do not cover the
  // video or stick the visit on play-AbortError. Only NotAllowedError
  // needs Tap to see Sara.
  if (!decision.benignAbort && (fromGesture || userAskedToSee || elementHoldsStream())) {
    if (decision.fallback) noteStreamFallback(decision.fallback)
    if (decision.showSeeOverlay) markSee(true)
  }
  logFacts('play')
}

function rememberPlayOk() {
  playLabel = 'played'
  markSee(false)
  logFacts('play')
}

/** Cap or Worker denial. A retryable WebRTC miss stays false so the next Send can connect. */
export function saraStreamConnectBlocked(): boolean {
  return sessionCapped || streamDenied
}

export function setSaraStreamTapReconnect(fn: (() => void) | null): void {
  reconnectForTap = fn
}

function requestTapReconnect() {
  if (saraStreamConnectBlocked()) return
  const phase = saraStreamPhase()
  if (phase === 'live' || phase === 'connecting') return
  // Home's Ask Sara link also calls gestureUnlock to prime play().
  // Only Ask Sara registers a reconnect, so that tap cannot mint a session.
  reconnectForTap?.()
}

/** Muted play() from a tap. Does not unmute. Arms the next mount if the node is missing. */
export function gestureUnlockSaraStream(): void {
  userAskedToSee = true
  requestTapReconnect()
  if (!videoEl) {
    gestureArmed = true
    logStream('gesture armed — stream video is not mounted yet')
    return
  }
  gestureArmed = false
  playMutedFromUser(videoEl, true)
}

function playMutedFromUser(video: HTMLVideoElement, fromTap = false) {
  // A gesture play has to run even if a retry is in flight. Bumping the
  // token drops that retry's result (its AbortError is not a fallback).
  playToken += 1
  clearPlayTimers()
  playPending = false
  playFollowUp = null
  if (fromTap) {
    if (srcObject) {
      if (video.src) video.src = ''
      if (video.srcObject !== srcObject) video.srcObject = srcObject
    }
    markSee(false)
  }
  invokeMutedPlay(video, true, () => {})
}

function invokeMutedPlay(video: HTMLVideoElement, fromGesture: boolean, onPlayed: () => void) {
  if (playPending) return
  const token = playToken
  let pending: Promise<void> | void
  try {
    pending = beginMutedGesturePlay(video)
  } catch (error) {
    rememberPlayError(error, fromGesture)
    return
  }
  const succeed = () => {
    if (token !== playToken) return
    rememberPlayOk()
    onPlayed()
  }
  const fail = (error: unknown) => {
    if (token !== playToken) return
    rememberPlayError(error, fromGesture)
  }
  if (pending && typeof pending.then === 'function') {
    playPending = true
    void Promise.resolve(pending).then(succeed, fail).finally(() => {
      if (token !== playToken) return
      playPending = false
      const follow = playFollowUp
      playFollowUp = null
      follow?.()
    })
    return
  }
  succeed()
}

function rememberStreamSession(info: { stream_id?: string; session_id?: string }) {
  const sid = String(info.session_id || '').trim()
  streamSessionId = sid || null
  logStream(
    'D-ID stream created',
    sid ? 'session_id present' : 'session_id missing — SDP finalize may 400',
  )
}

function isDidStreamWrite(url: string, method: string): boolean {
  if (!/https?:\/\/api\.d-id\.com\/agents\/[^/]+\/streams\//i.test(url)) return false
  return method === 'POST' || method === 'PUT'
}

/** Insert session_id so D-ID SDP finalize does not 400 SessionError. */
export function ensureDidStreamSessionBody(
  raw: string,
  sessionId: string | null,
): { body: string; patched: boolean } {
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    if (!json || typeof json !== 'object') return { body: raw, patched: false }
    if (typeof json.session_id === 'string' && json.session_id) return { body: raw, patched: false }
    if (typeof json.sessionId === 'string' && json.sessionId) {
      json.session_id = json.sessionId
    } else if (sessionId) {
      json.session_id = sessionId
    } else {
      return { body: raw, patched: false }
    }
    return { body: JSON.stringify(json), patched: true }
  } catch {
    return { body: raw, patched: false }
  }
}

function withDidSessionId(raw: string): { body: string; patched: boolean } {
  return ensureDidStreamSessionBody(raw, streamSessionId)
}

/** First SDP finalize 400 is SessionError (no session_id). Insert it from stream/created. */
function patchDidSessionFetch() {
  if (didFetchPatched || typeof window === 'undefined') return
  didFetchPatched = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!streamSessionId) return nativeFetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = String(
      init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'),
    ).toUpperCase()
    if (!isDidStreamWrite(url, method)) return nativeFetch(input, init)
    if (typeof init?.body !== 'string') return nativeFetch(input, init)
    const next = withDidSessionId(init.body)
    if (!next.patched) return nativeFetch(input, init)
    logStream('SDP/ICE request missing session_id — inserting from stream/created')
    return nativeFetch(input, { ...init, body: next.body })
  }
}

function isSessionIdError(error: unknown): boolean {
  const blob = `${describeError(error)} ${errorBlob(error)}`
  return /SessionError|missing or invalid session_id/i.test(blob)
}

function bindLateTracks(stream: MediaStream) {
  noteTracks(stream)
  if (lateTrackStreams.has(stream)) return
  lateTrackStreams.add(stream)
  // Do not listen for track 'unmute'. Re-clearing srcObject there fires
  // 'emptied' and the still photo covers a video that was already playing.
  // WebKit only misses a video track that was absent when srcObject was set.
  let waitingForVideo = stream.getVideoTracks().length === 0
  stream.addEventListener('addtrack', () => {
    noteTracks(stream)
    if (!waitingForVideo || stream.getVideoTracks().length === 0) return
    waitingForVideo = false
    if (srcObject !== stream || !videoEl) return
    // Cancel queued play() calls before the element load, or they abort
    // each other and the emptied event puts the still back up.
    playToken += 1
    clearPlayTimers()
    playPending = false
    playFollowUp = null
    if (videoEl.src) videoEl.src = ''
    if (videoEl.srcObject === stream) videoEl.srcObject = null
    videoEl.srcObject = stream
    applyHeardMute(videoEl)
    schedulePlay(videoEl)
    maybePromoteHeard()
  })
}

function setVoicePath(next: SaraStreamVoicePath) {
  voicePath = next
  if (next === 'ara') fallbackLocked = true
  if (next === 'idle' || next === 'pending') fallbackLocked = false
  if (next === 'idle' || next === 'ara') speakingStarted = false
  if (videoEl) applyHeardMute(videoEl)
}

export function setSaraStreamKeepMuted(keep: boolean): void {
  keepStreamMuted = keep
}

/** Speech frames are on screen (speak started, decoded, not paused). */
export function isSaraStreamSpeechLive(): boolean {
  return framesArePlayable()
}

function resolveAvReady(ready: boolean) {
  const waiters = avReadyWaiters.splice(0, avReadyWaiters.length)
  waiters.forEach((fn) => fn(ready))
}

function maybePromoteHeard() {
  if (fallbackLocked) return
  if (voicePath !== 'pending' && voicePath !== 'did' && voicePath !== 'visual') return
  if (!speakingStarted || !streamHasLiveFrames()) {
    if (videoEl) applyHeardMute(videoEl)
    return
  }
  if (keepStreamMuted || voicePath === 'visual') {
    if (voicePath !== 'visual') setVoicePath('visual')
    if (videoEl) {
      applyHeardMute(videoEl)
      schedulePlay(videoEl)
    }
    listeners.onTalking?.(true)
    resolveAvReady(true)
    return
  }
  setVoicePath('did')
  if (videoEl && !videoEl.paused && unmuteInPlace(videoEl)) {
    listeners.onStreamAudible?.(true)
  } else if (videoEl) {
    schedulePlay(videoEl)
  }
  listeners.onTalking?.(true)
  resolveAvReady(true)
}

function avBudgetMs(): number {
  return elementHoldsStream() ? STREAM_AV_READY_MS : STREAM_SRC_WAIT_MS
}

function framesArePlayable(): boolean {
  return speakingStarted && streamHasLiveFrames() && elementHoldsStream()
}

function waitForAvReady(): Promise<boolean> {
  if ((voicePath === 'did' || voicePath === 'visual') && framesArePlayable()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      window.clearInterval(poll)
      window.clearTimeout(cap)
      const idx = avReadyWaiters.indexOf(onReady)
      if (idx >= 0) avReadyWaiters.splice(idx, 1)
      resolve(ready)
    }
    const onReady = (ready: boolean) => finish(ready)
    const poll = window.setInterval(() => {
      if ((voicePath === 'did' || voicePath === 'visual') && framesArePlayable()) {
        finish(true)
        return
      }
      if (Date.now() - started >= avBudgetMs()) finish(false)
    }, 120)
    const cap = window.setTimeout(() => finish(false), STREAM_AV_READY_MS)
    avReadyWaiters.push(onReady)
  })
}

function onAvCue() {
  noteFirstFrame()
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
      if (voicePath === 'did' || voicePath === 'visual') setVoicePath('idle')
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
  const token = playToken
  const kick = () => {
    if (token !== playToken || videoEl !== video) return
    const wantAudible = !streamVideoShouldBeMuted({
      voicePath,
      userMuted,
      videoLive: isSaraVideoLive(video),
    })
    if (!video.paused && isSaraVideoLive(video)) {
      if (wantAudible && video.muted) {
        if (unmuteInPlace(video)) listeners.onStreamAudible?.(true)
        else {
          noteStreamFallback('unmute')
          if (voicePath === 'did') setVoicePath('visual')
          listeners.onStreamAudible?.(false)
        }
      }
      return
    }
    if (playPending) {
      playFollowUp = () => kick()
      return
    }
    // Always play muted. Unmute only after the element is already playing.
    invokeMutedPlay(video, false, () => {
      if (!wantAudible || videoEl !== video || token !== playToken) return
      if (unmuteInPlace(video)) {
        listeners.onStreamAudible?.(true)
        return
      }
      noteStreamFallback('unmute')
      if (voicePath === 'did') setVoicePath('visual')
      listeners.onStreamAudible?.(false)
    })
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
    bindLateTracks(stream)
    // Keep muted + tracks off until speak + visible frames so late play() can decode.
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
  streamSessionId = null
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
  trackReceived = false
  iceState = '—'
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

export type SaraStreamPhase = 'idle' | 'connecting' | 'live' | 'failed'

/** idle / connecting / live / failed. Live means the WebRTC session exists, not that frames are painted. */
export function saraStreamPhase(): SaraStreamPhase {
  if (sessionCapped || connectFailed) return 'failed'
  if (hasLiveManager()) return 'live'
  if (connectPromise) return 'connecting'
  return 'idle'
}

/** Cancel a pending unmount close. Does not mint or open a second session. */
export function keepSaraStream(): void {
  streamWanted = true
  cancelRelease()
}

/**
 * Close the current D-ID session now (SDK disconnect).
 * Does not renew the Worker lease — that key expires on its TTL.
 */
export function retireDemoStream(): void {
  streamWanted = false
  connectFailed = false
  dropLiveSession()
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
    if (gestureArmed) {
      gestureArmed = false
      playMutedFromUser(el, true)
    }
    return
  }
  // Video node gone (StrictMode remount, leave page) — do not leave streamReady
  // true or the still stays at opacity 0 over an empty sage circle.
  setReady(false)
}

/** Call from Send / Play — same user-gesture window as ara unlock.
 * Starts muted play() so later srcObject can decode. Does not unmute.
 */
export function unlockSaraStream(): void {
  if (voicePath === 'idle') setVoicePath('pending')
  if (!videoEl) {
    gestureArmed = true
    userAskedToSee = true
    return
  }
  // Same turn as Send / Play / Test voice. Muted, before any await.
  playMutedFromUser(videoEl)
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

/** Remute after an unreachable Grok reply, when ara takes over, or for muted visuals. */
export function settleSaraStreamVoice(path: 'idle' | 'ara' | 'visual'): void {
  setVoicePath(path)
  if (videoEl) applyHeardMute(videoEl)
}

export function setSaraStreamCallbacks(next: StreamCallbacks) {
  listeners.onTalking = next.onTalking
  listeners.onReady = next.onReady
  listeners.onStatus = next.onStatus
  listeners.onVoiceFallback = next.onVoiceFallback
  listeners.onSeeSara = next.onSeeSara
  listeners.onStreamAudible = next.onStreamAudible
  if (next.onSeeSara) next.onSeeSara(seeBlocked)
  if (next.onReady) next.onReady(streamReady)
  if (next.onStatus && sessionCapped) next.onStatus('session_capped')
}

/** Reuse a minted client key until this long before it expires. */
const STREAM_KEY_REUSE_MS = 30_000

export type SaraConnectTiming = {
  mintMs: number | null
  /** True when this connect did not POST /stream because the key was still inside its TTL. */
  mintCached: boolean
  sdkMs: number | null
  agentMs: number | null
  createMs: number | null
  streamPostMs: number | null
  sdpMs: number | null
  /** ICE gathering duration after the peer connection exists. */
  iceGatherMs: number | null
  /** Offset from connect start to iceConnectionState connected/completed. */
  iceConnectedMs: number | null
  connectMs: number | null
  firstFrameMs: number | null
  totalMs: number | null
}

const emptyTiming = (): SaraConnectTiming => ({
  mintMs: null,
  mintCached: false,
  sdkMs: null,
  agentMs: null,
  createMs: null,
  streamPostMs: null,
  sdpMs: null,
  iceGatherMs: null,
  iceConnectedMs: null,
  connectMs: null,
  firstFrameMs: null,
  totalMs: null,
})

let connectTiming = emptyTiming()
let connectT0 = 0
let peerWatchGen = 0
let credsCache: SaraStreamCreds | null = null
let credsInflight: Promise<SaraStreamCreds | null> | null = null
let credsGen = 0
/** Demo landing can mint before Continue writes the local session. Paid passes never use this. */
let passOverride = ''

export function saraStreamConnectTiming(): SaraConnectTiming {
  return { ...connectTiming }
}

export function saraStreamTimingLabel(): string {
  const t = connectTiming
  const n = (value: number | null) => (value == null ? '—' : String(value))
  const mint = t.mintCached ? 'cached' : n(t.mintMs)
  return `mint ${mint} · sdk ${n(t.sdkMs)} · agent ${n(t.agentMs)} · create ${n(t.createMs)} · stream ${n(t.streamPostMs)} · sdp ${n(t.sdpMs)} · gather ${n(t.iceGatherMs)} · iceAt ${n(t.iceConnectedMs)} · connect ${n(t.connectMs)} · up ${n(t.totalMs)} · frame ${n(t.firstFrameMs)}`
}

function publishTiming(reason: string) {
  if (connectT0) connectTiming.totalMs = Math.round(performance.now() - connectT0)
  logStream('timing', `${reason} ${saraStreamTimingLabel()}`)
}

function noteFirstFrame() {
  if (!connectT0 || connectTiming.firstFrameMs != null) return
  if (!isSaraVideoLive(videoEl)) return
  connectTiming.firstFrameMs = Math.round(performance.now() - connectT0)
  publishTiming('first-frame')
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function noteNetworkTiming(method: string, url: string, ms: number) {
  if (!connectT0) return
  const path = url.split('?')[0]
  const rounded = Math.round(ms)
  if (method === 'POST' && /\/stream$/.test(path)) {
    if (connectTiming.mintMs == null) connectTiming.mintMs = rounded
    return
  }
  if (method === 'GET' && /\/runtime$/.test(path)) {
    if (connectTiming.agentMs == null) connectTiming.agentMs = rounded
    return
  }
  if (method === 'POST' && /\/streams$/.test(path)) {
    if (connectTiming.streamPostMs == null) connectTiming.streamPostMs = rounded
    return
  }
  if (method === 'POST' && /\/sdp$/.test(path)) {
    if (connectTiming.sdpMs == null) connectTiming.sdpMs = rounded
  }
}

function observePeer(pc: RTCPeerConnection) {
  const watch = peerWatchGen
  const gatherStart = performance.now()
  pc.addEventListener('icegatheringstatechange', () => {
    if (watch !== peerWatchGen) return
    if (pc.iceGatheringState === 'complete' && connectTiming.iceGatherMs == null) {
      connectTiming.iceGatherMs = Math.round(performance.now() - gatherStart)
      logStream('timing', `ice-gathering-complete ${saraStreamTimingLabel()}`)
    }
  })
  pc.addEventListener('iceconnectionstatechange', () => {
    if (watch !== peerWatchGen) return
    const state = pc.iceConnectionState
    if ((state === 'connected' || state === 'completed') && connectTiming.iceConnectedMs == null && connectT0) {
      connectTiming.iceConnectedMs = Math.round(performance.now() - connectT0)
      logStream('timing', `ice-connected ${saraStreamTimingLabel()}`)
    }
  })
}

/** Installed before the Agents SDK evaluates, because the SDK binds RTCPeerConnection at import. */
function installConnectObservers() {
  if (typeof window === 'undefined') return
  const win = window as Window & { __saraConnectObserved?: boolean }
  if (win.__saraConnectObserved) return
  win.__saraConnectObserved = true
  const OrigPC = window.RTCPeerConnection
  if (OrigPC) {
    const Wrapped = function (this: RTCPeerConnection, config?: RTCConfiguration) {
      const pc = new OrigPC(config)
      observePeer(pc)
      return pc
    }
    Wrapped.prototype = OrigPC.prototype
    window.RTCPeerConnection = Wrapped as unknown as typeof RTCPeerConnection
  }
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(
      init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'),
    ).toUpperCase()
    const url = requestUrl(input)
    const start = performance.now()
    return nativeFetch(input, init).then((res) => {
      noteNetworkTiming(method, url, performance.now() - start)
      return res
    })
  }
}

installConnectObservers()

export function setSaraStreamPassOverride(pass: string): void {
  passOverride = isDemoPass(pass) ? String(pass).trim() : ''
}

function credsStillFresh(creds: SaraStreamCreds | null, now = Date.now()): boolean {
  if (!creds?.agentId || !creds.clientKey) return false
  if (creds.expiresAt == null) return true
  return creds.expiresAt - now > STREAM_KEY_REUSE_MS
}

/** Drop the cached client key so the next session POSTs /stream and counts against the gate. */
export function discardSaraStreamCreds(): void {
  credsGen += 1
  credsCache = null
  credsInflight = null
}

export async function fetchSaraStreamCreds(): Promise<SaraStreamCreds | null> {
  if (credsStillFresh(credsCache)) {
    connectTiming.mintCached = true
    connectTiming.mintMs = 0
    return credsCache
  }
  if (credsInflight) return credsInflight
  const gen = credsGen
  const pending = fetchSaraStreamCredsFresh()
  credsInflight = pending
  try {
    const creds = await pending
    if (gen === credsGen && credsStillFresh(creds)) credsCache = creds
    return creds
  } finally {
    if (credsInflight === pending) credsInflight = null
  }
}

async function fetchSaraStreamCredsFresh(): Promise<SaraStreamCreds | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`${apiBase()}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ pass: currentSaraPass() || passOverride }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      agentId?: string | null
      clientKey?: string | null
      expiresAt?: number | null
      error?: string | null
    }
    if (!res.ok || !data.agentId || !data.clientKey) {
      if (
        res.status === 429 ||
        res.status === 402 ||
        res.status === 403 ||
        data.error === 'did_unavailable'
      ) {
        streamDenied = true
      }
      return null
    }
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
  connectFailed = false
  cancelRelease()
  bindSessionLifecycle()
  patchDidSessionFetch()
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
      connectT0 = performance.now()
      connectTiming = emptyTiming()
      peerWatchGen += 1
      const cachedKey = credsStillFresh(credsCache)
      const parallelStart = performance.now()
      const [creds, create] = await Promise.all([
        fetchSaraStreamCreds(),
        loadSdk().then((factory) => {
          connectTiming.sdkMs = Math.round(performance.now() - parallelStart)
          return factory
        }),
      ])
      if (cachedKey) {
        connectTiming.mintCached = true
        connectTiming.mintMs = 0
      }
      if (!creds || session !== sessionGen) {
        logStream('no stream credentials — keeping still')
        publishTiming('no-creds')
        return false
      }
      if (!create || session !== sessionGen) return false
      const createStart = performance.now()
      created = await create(creds.agentId, {
        auth: { type: 'key', clientKey: creds.clientKey },
        mode: SPEAK_MODE,
        enableAnalytics: false,
          streamOptions: {
          compatibilityMode: 'on',
          // iOS often never decodes warmup; gating connect() on that leaves speak() dead.
          // Warmup also delays the SDK's connected callback until that clip ends.
          streamWarmup: false,
          outputResolution: 512,
        },
        callbacks: {
          onSrcObjectReady(value: MediaStream) {
            // disconnect() also fires this, often with an empty stream, during
            // the SDP finalize 400 → retry 200 flap. Keep a usable srcObject.
            const tracks = typeof value?.getTracks === 'function' ? value.getTracks() : []
            if (value && tracks.length) {
              noteTracks(value)
              attachSrcObject(value)
              if (elementHoldsStream() && !sessionCapped) listeners.onStatus?.('live')
              return value
            }
            if (srcObject) {
              logStream('onSrcObjectReady empty — keeping existing srcObject')
              attachSrcObject(srcObject)
              return srcObject
            }
            if (value) attachSrcObject(value)
            return value
          },
          onStreamCreated(info: { stream_id?: string; session_id?: string }) {
            rememberStreamSession(info)
          },
          onVideoStateChange(state: string) {
            const talking = String(state).toUpperCase() !== 'STOP'
            if (talking) {
              speakingStarted = true
              // Official D-ID demo re-assigns srcObject on START (warmup-off tracks arrive here).
              if (srcObject) attachSrcObject(srcObject)
              // Do not unmute on START alone — wait for decoded frames.
              maybePromoteHeard()
            }
            if (srcObject && videoEl) schedulePlay(videoEl)
            listeners.onTalking?.(talking)
            if (!talking) {
              speakingStarted = false
              if (voicePath === 'did' || voicePath === 'visual') setVoicePath('idle')
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
            iceState = s === 'fail' ? 'failed' : s
            logFacts('ice')
            if (s === 'failed' || s === 'fail') noteStreamFallback('ice-failed')
            if (s === 'connected') {
              if (srcObject) attachSrcObject(srcObject)
              else logStream('peer connected — waiting for srcObject')
            }
            if (s === 'fail' || s === 'closed') {
              logStream('peer closed — will reconnect on next speak', s)
              deadMode = true
              setReady(false)
              resolveAvReady(false)
              if (voicePath === 'did' || voicePath === 'visual') {
                markVoiceFallback('peer closed without playable video — falling back to ara')
              }
            } else if (s === 'disconnected' && !elementHoldsStream()) {
              logStream('peer has no video srcObject — keeping still', s)
              setReady(false)
              // Intermediate 400 flap: do not resolveAvReady(false) — the 200 retry may attach.
              if (voicePath === 'did' || voicePath === 'visual') {
                markVoiceFallback('peer has no video srcObject — falling back to ara')
              }
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
            if (isSessionIdError(error)) {
              logStream('D-ID session_id finalize error — waiting for SDK retry', describeError(error))
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
      connectTiming.createMs = Math.round(performance.now() - createStart)
      if (session !== sessionGen || sessionCapped) {
        publishTiming('superseded')
        return false
      }
      manager = created
      const connectStart = performance.now()
      await created.connect()
      connectTiming.connectMs = Math.round(performance.now() - connectStart)
      if (session !== sessionGen || deadMode || sessionCapped) {
        publishTiming('connect-dropped')
        return false
      }
      if (srcObject) attachSrcObject(srcObject)
      // Keep the session without frames. Warmup is off; speak() attaches the talking track.
      // ICE trickle is already how the SDK works (answer is sent, then candidates).
      // Gathering finishes in a few hundred ms; the long wait is POST /streams.
      if (!elementHoldsStream()) {
        logStream('connected — no video frames yet; session kept for speak()')
      } else {
        listeners.onStatus?.('live')
      }
      keepSession = true
      publishTiming('connected')
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
    connectFailed = true
    dropManager()
    fallBackToStill('stream unavailable — still stays visible')
  }
  return ok
}

function markHeard(result: unknown, gen: number): SaraStreamSpeakResult {
  if (gen !== speakGen || fallbackLocked) return 'fallback'
  speakingStarted = true
  maybePromoteHeard()
  if (voicePath === 'visual' && framesArePlayable()) {
    scheduleTalkingEnd(result, gen)
    logStream('D-ID video is muted for visuals — ara stays the heard voice')
    return 'heard'
  }
  if (voicePath !== 'did' || !framesArePlayable()) return 'fallback'
  scheduleTalkingEnd(result, gen)
  logStream('D-ID stream audio is the heard voice — skipping ara')
  return 'heard'
}

function markVoiceFallback(reason: string, detail?: unknown): SaraStreamSpeakResult {
  const wasHeard = voicePath === 'did' || voicePath === 'visual'
  setVoicePath('ara')
  if (videoEl) applyHeardMute(videoEl)
  logStream(reason, detail)
  if (wasHeard) listeners.onVoiceFallback?.()
  return 'fallback'
}

export async function speakSaraStream(text: string): Promise<SaraStreamSpeakResult> {
  const clean = rewritePfilatesForSpeech(text.replace(/\s+/g, ' ').trim())
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
    const avReady = waitForAvReady()
    const speakPromise = manager.speak({ type: 'text', input: clean }).then((result) => {
      if (speakLooksDead(result)) {
        deadMode = true
        resolveAvReady(false)
        throw new Error('D-ID speak no-op')
      }
      if (speakHasVideo(result)) {
        speakingStarted = true
        if (srcObject) attachSrcObject(srcObject)
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
      if (ready || (voicePath === 'did' && framesArePlayable())) {
        return markHeard(first.result, gen)
      }
    }
    if (!elementHoldsStream()) {
      logStream('speak finished with no video srcObject — will fall back to ara')
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
    if (outcome === 'heard' && !fallbackLocked && framesArePlayable()) return 'heard'
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
  keepStreamMuted = false
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
