import { readLastOpened, touchOpened } from './mockServer'

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/** Stub: would register a Web Push subscription for gentle check-ins. */
export async function requestPushPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  return result
}

export function pushIsDefaultChannel(): boolean {
  return true
}

/**
 * Stub SMS hook: if the companion isn't opened for 3 days, a real backend
 * would send one SMS check-in. Push remains the default channel.
 */
export function evaluateSmsFallback(now = Date.now()): {
  wouldSendSms: boolean
  daysSinceOpen: number
} {
  const last = readLastOpened()
  if (!last) {
    touchOpened()
    return { wouldSendSms: false, daysSinceOpen: 0 }
  }
  const elapsed = now - new Date(last).getTime()
  const daysSinceOpen = elapsed / (24 * 60 * 60 * 1000)
  return {
    wouldSendSms: elapsed >= THREE_DAYS_MS,
    daysSinceOpen,
  }
}

export function markCompanionOpened(): ReturnType<typeof evaluateSmsFallback> {
  // Push is the default reminder channel; SMS is the 3-day quiet fallback.
  void pushIsDefaultChannel()
  const evaluation = evaluateSmsFallback()
  touchOpened()
  return evaluation
}
