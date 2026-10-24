import { isIosUserAgent } from './installCoach.ts'

/**
 * After a warmed session speaks, wait this long for speech frames.
 * A session that is still connecting does not use this wait — ara starts
 * as soon as its first chunk is ready.
 */
export const DEMO_DID_FRAME_BUDGET_MS = 3000

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
}): DemoVoiceChoice {
  if (opts.araStarted) return 'ara'
  if (!opts.streamWarm) {
    if (opts.chunkReady || opts.didFailed || opts.budgetExceeded) return 'ara'
    return 'wait'
  }
  if (opts.didFailed) return 'ara'
  if (opts.speechFramesLive) return 'did-audio'
  if (opts.budgetExceeded) return 'ara'
  return 'wait'
}
