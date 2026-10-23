import { isIosUserAgent } from './installCoach.ts'

/** Hard max wait for D-ID speech frames on the demo pass. Not a delay if ara is ready sooner. */
export const DEMO_DID_FRAME_BUDGET_MS = 3000

/**
 * On iPhone, a muted D-ID video can sit with ara only when both start together.
 * D-ID's own TTS is not ara, so a mouth that is already ahead is hidden.
 */
export const DEMO_DID_SYNC_MS = 500

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
  framesReadyAt: number | null
  chunkReadyAt: number | null
  now: number
  iosSilentSwitch: boolean
}): DemoVoiceChoice {
  if (opts.araStarted) return 'ara'
  if (opts.didFailed) return 'ara'
  if (opts.chunkReady && !opts.speechFramesLive) return 'ara'
  if (!opts.speechFramesLive) {
    return opts.budgetExceeded ? 'ara' : 'wait'
  }
  if (!opts.iosSilentSwitch) return 'did-audio'
  if (!opts.chunkReady) return opts.budgetExceeded ? 'ara' : 'wait'
  const framesAt = opts.framesReadyAt ?? opts.now
  const chunkAt = opts.chunkReadyAt ?? opts.now
  if (Math.abs(chunkAt - framesAt) <= DEMO_DID_SYNC_MS) return 'did-visual-ara'
  return 'ara'
}
