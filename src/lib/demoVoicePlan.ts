import { isIosUserAgent } from './installCoach.ts'

/**
 * After a warmed session speaks, wait this long for speech frames.
 * A session that is still connecting does not use this wait.
 */
export const DEMO_DID_FRAME_BUDGET_MS = 3000

/**
 * From the Send / Play / Test voice tap. If the WebRTC session is still
 * not live when this elapses, this turn speaks with ara. A later reply
 * uses video once the same session connects. This is not the 25s iOS
 * connect give-up.
 */
export const DEMO_SEND_LIVE_BUDGET_MS = 6_000

/** Shown on the still while the muted warm connect is in progress. */
export const SARA_GETTING_READY = 'Sara is getting ready'

export const SARA_DEMO_SILENT_HINT = 'No sound? Turn off the Silent switch.'

export type DemoVoiceChoice = 'wait' | 'did-audio' | 'did-visual-ara' | 'ara'

/**
 * D-ID <video srcObject> audio is WebRTC. iOS plays that on the same session
 * the hardware Silent switch mutes. A blob/file HTMLAudioElement does not.
 * There is no web API to read the switch, so iPhone and iPad always take
 * the silenced path.
 */
export function didWebRtcSilencedBySilentSwitch(
  ua = '',
  platform = '',
  maxTouchPoints = 0,
): boolean {
  return isIosUserAgent(ua, platform, maxTouchPoints)
}

export function planDemoVoice(opts: {
  araStarted: boolean
  didFailed: boolean
  budgetExceeded: boolean
  speechFramesLive: boolean
  chunkReady: boolean
  /** WebRTC session already up. Frames still arrive on speak(). */
  streamWarm: boolean
  /** muted=false stuck on an element that was already playing. Defaults to yes. */
  unmuted?: boolean
  /** Gesture play() or in-place unmute failed. Keep the picture, use ara. */
  unmuteBlocked?: boolean
  /** Decoded frames exist even when they are not the heard speech path. */
  framesVisible?: boolean
  /**
   * Connect is still in flight and this turn can still catch it.
   * Holds ara until `budgetExceeded` (the send budget) instead of the first chunk.
   */
  awaitingLive?: boolean
}): DemoVoiceChoice {
  const unmuted = opts.unmuted !== false
  const unmuteBlocked = opts.unmuteBlocked === true
  const framesVisible = opts.framesVisible === true || opts.speechFramesLive
  if (opts.araStarted) return 'ara'
  if (!opts.streamWarm) {
    if (opts.awaitingLive && !opts.didFailed && !opts.budgetExceeded) return 'wait'
    if (opts.chunkReady || opts.didFailed || opts.budgetExceeded) return 'ara'
    return 'wait'
  }
  if (opts.speechFramesLive && unmuted && !unmuteBlocked && !opts.didFailed) return 'did-audio'
  if (framesVisible && (unmuteBlocked || opts.didFailed || (opts.budgetExceeded && !unmuted))) return 'did-visual-ara'
  if (opts.didFailed) return 'ara'
  if (opts.budgetExceeded) return 'ara'
  return 'wait'
}
