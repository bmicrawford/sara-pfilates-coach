/**
 * iOS WebKit only allows video.play() inside a user gesture, and it rejects
 * that call when the element is already unmuted. Play muted in the gesture.
 * Unmute later by setting muted=false on an element that is already playing.
 */

export const SARA_SEE_LABEL = 'Tap to see Sara'

/** Warm connect is ~11s when it works. Past this, iOS is not going to get a session. */
export const IOS_WEBRTC_BUDGET_MS = 15_000

export type GestureVideo = {
  muted: boolean
  defaultMuted: boolean
  paused: boolean
  playsInline: boolean
  volume: number
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  play(): Promise<void> | void
}

/** Attributes and mute first, then play() before this function returns. */
export function beginMutedGesturePlay(video: GestureVideo): Promise<void> | void {
  video.playsInline = true
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.muted = true
  video.defaultMuted = true
  video.volume = 0
  video.setAttribute('muted', '')
  return video.play()
}

/**
 * Unmute without calling play() again. A paused element stays muted —
 * unmuted play() outside the gesture is what iOS rejects.
 */
export function unmuteInPlace(video: GestureVideo): boolean {
  if (video.paused) return false
  try {
    video.volume = 1
    video.muted = false
    video.defaultMuted = false
    video.removeAttribute('muted')
  } catch {
    return false
  }
  return video.muted === false && video.paused === false
}

export function iosWebrtcMissed(opts: { elapsedMs: number; phase: string }): boolean {
  return opts.elapsedMs >= IOS_WEBRTC_BUDGET_MS && opts.phase !== 'live'
}

export function playErrorName(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (name) return name
  const message = (error as { message?: string } | null)?.message
  return message ? message.slice(0, 40) : 'Error'
}
