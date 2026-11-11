import { currentSaraPass } from './demoPass.ts'
import { readSession } from './mockServer.ts'

export const REMINDER_BODY = 'Time for your 10-minute PfilAtes™ routine'

export type ReminderView = {
  enabled: boolean
  time: string | null
  timeZone: string | null
  suppressed?: boolean
}

function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
  return `${base}${path}`
}

function passQuery(email: string): string {
  const params = new URLSearchParams({
    pass: currentSaraPass(),
    email,
  })
  return params.toString()
}

export function reminderEmail(): string {
  return readSession()?.email?.trim() ?? ''
}

export function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function timeZoneOptions(detected = detectedTimeZone()): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const zones = supported.includes(detected) ? supported : [detected, ...supported]
  return zones.length > 0 ? zones : ['UTC']
}

export async function loadReminder(email: string): Promise<ReminderView | null> {
  if (!email) return null
  try {
    const res = await fetch(`${apiUrl('/reminders')}?${passQuery(email)}`)
    const data = (await res.json().catch(() => ({}))) as ReminderView & { error?: string }
    if (!res.ok) return null
    return {
      enabled: data.enabled === true,
      time: data.time ?? null,
      timeZone: data.timeZone ?? null,
      suppressed: data.suppressed === true,
    }
  } catch {
    return null
  }
}

export async function fetchVapidPublicKey(email: string): Promise<string | { error: string }> {
  try {
    const res = await fetch(`${apiUrl('/reminders/vapid')}?${passQuery(email)}`)
    const data = (await res.json().catch(() => ({}))) as { publicKey?: string; error?: string }
    if (!res.ok || !data.publicKey) return { error: data.error || 'reminders_unconfigured' }
    return data.publicKey
  } catch {
    return { error: 'unreachable' }
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const bin = atob(padded)
  const buffer = new ArrayBuffer(bin.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export async function subscribeForReminder(publicKey: string): Promise<PushSubscription | { error: string }> {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { error: 'unsupported' }
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { error: 'denied' }
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))
  return subscription
}

export async function saveReminder(input: {
  email: string
  time: string
  timeZone: string
  subscription: PushSubscription
}): Promise<{ ok: true; enabled: true } | { ok: false; error: string }> {
  const json = input.subscription.toJSON()
  try {
    const res = await fetch(apiUrl('/reminders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pass: currentSaraPass(),
        email: input.email,
        enabled: true,
        time: input.time,
        timeZone: input.timeZone,
        subscription: json,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return { ok: false, error: data.error || 'save_failed' }
    return { ok: true, enabled: true }
  } catch {
    return { ok: false, error: 'unreachable' }
  }
}

export async function disableReminder(email: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/reminders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pass: currentSaraPass(),
        email,
        enabled: false,
      }),
    })
    if (!res.ok) return false
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()
    }
    return true
  } catch {
    return false
  }
}

export function reminderProblem(error: string): string {
  if (error === 'suppressed') return 'This email is on the do-not-contact list. No reminder will be sent.'
  if (error === 'not_entitled' || error === 'email_mismatch') {
    return 'A daily reminder is available with a purchased PfilAtes™ pass.'
  }
  if (error === 'reminders_unconfigured') return 'Daily reminders are not available on this server yet.'
  if (error === 'unsupported') return 'This browser cannot show a daily reminder.'
  if (error === 'denied') return 'Notifications are blocked in this browser. The reminder stays off.'
  return 'The reminder could not be saved. It is still off.'
}
