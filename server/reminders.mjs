/**
 * Opt-in daily reminder for an entitled email.
 * Subscriptions live in the Worker KV (same REDEEM_TOKENS namespace, `reminder:` prefix).
 * The do-not-contact list is ops-supplied: env REMINDER_SUPPRESS_EMAILS and/or KV `ops:do-not-contact`.
 * Never hardcode a person's email in this file.
 */

import { DEMO_TOKEN, normalizeEmail } from './redeem.mjs'
import { passFromParts } from './demoGate.mjs'
import { sendWebPush } from './webPush.mjs'

export const REMINDER_TITLE = 'Sara'
export const REMINDER_BODY = 'Time for your 10-minute PfilAtes™ routine'
export const REMINDER_PREFIX = 'reminder:'
export const SUPPRESS_KV_KEY = 'ops:do-not-contact'
export const DUE_WINDOW_MINUTES = 15

export function reminderPayload() {
  return JSON.stringify({ title: REMINDER_TITLE, body: REMINDER_BODY })
}

export function parseReminderTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim())
  if (!match) return null
  return `${match[1]}:${match[2]}`
}

export function validTimeZone(value) {
  const zone = String(value ?? '').trim()
  if (!zone || zone.length > 100 || zone.includes('\0')) return null
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)
    return zone
  } catch {
    return null
  }
}

export function localClock(now, timeZone) {
  const zone = validTimeZone(timeZone)
  if (!zone) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  const minute = Number(parts.minute)
  if (!parts.year || Number.isNaN(hour) || Number.isNaN(minute)) return null
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
  }
}

export function reminderIsDue(record, now = new Date()) {
  if (!record?.time || !record.timeZone || !record.endpoint) return false
  const clock = localClock(now, record.timeZone)
  if (!clock) return false
  if (record.lastSentLocalDate === clock.date) return false
  const time = parseReminderTime(record.time)
  if (!time) return false
  const [hh, mm] = time.split(':').map(Number)
  const delta = clock.minutes - (hh * 60 + mm)
  return delta >= 0 && delta < DUE_WINDOW_MINUTES
}

export function parseSuppressList(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value.emails)) return value.emails
  const text = String(value ?? '').trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Fall through to a split of the raw text.
    }
  }
  return text.split(/[\s,;]+/)
}

export function suppressedEmailSet(envList, kvValue) {
  const set = new Set()
  for (const raw of [...parseSuppressList(envList), ...parseSuppressList(kvValue)]) {
    const email = normalizeEmail(raw)
    if (email) set.add(email)
  }
  return set
}

export function parseSubscription(value) {
  if (!value || typeof value !== 'object') return null
  const endpoint = String(value.endpoint ?? '').trim()
  const keys = value.keys && typeof value.keys === 'object' ? value.keys : value
  const p256dh = String(keys.p256dh ?? '').trim()
  const auth = String(keys.auth ?? '').trim()
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (p256dh.length < 80 || p256dh.length > 200 || auth.length < 16 || auth.length > 64) return null
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return null
  return { endpoint, p256dh, auth }
}

export function vapidFromEnv(env = {}) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim()
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim()
  const subject = String(env.VAPID_SUBJECT || '').trim()
  if (!publicKey || !privateKey || !subject) return null
  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject)) return null
  return { publicKey, privateKey, subject }
}

export function remindersConfigured(env = {}) {
  return Boolean(vapidFromEnv(env))
}

function presentedPass(ctx) {
  const header = ctx.getHeader ? String(ctx.getHeader('x-sara-pass') || '').trim() : ''
  const query = ctx.query?.get?.('pass') ?? ctx.query?.pass ?? ''
  return passFromParts({
    body: ctx.body,
    header: header || undefined,
    query,
  })
}

function presentedEmail(ctx) {
  const fromBody = ctx.body?.email
  const fromQuery = ctx.query?.get?.('email') ?? ctx.query?.email
  return normalizeEmail(fromBody ?? fromQuery)
}

async function requireEntitled(ctx) {
  const token = presentedPass(ctx)
  const email = presentedEmail(ctx)
  if (!token || !email) return { ok: false, result: { status: 400, body: { ok: false, error: 'invalid' } } }
  if (token === DEMO_TOKEN) return { ok: false, result: { status: 403, body: { ok: false, error: 'not_entitled' } } }
  const record = await ctx.redeemStore.get(token)
  if (!record) return { ok: false, result: { status: 403, body: { ok: false, error: 'not_entitled' } } }
  if (record.multiUse === true) return { ok: true, email }
  const bound = record.email ? normalizeEmail(record.email) : null
  if (bound && bound !== email) {
    return { ok: false, result: { status: 409, body: { ok: false, error: 'email_mismatch' } } }
  }
  return { ok: true, email: bound || email }
}

function statusView(record) {
  if (!record) return { ok: true, enabled: false, time: null, timeZone: null }
  return { ok: true, enabled: true, time: record.time, timeZone: record.timeZone }
}

export async function dispatchReminderRequest(pathname, method, ctx) {
  if (pathname !== '/reminders' && pathname !== '/reminders/vapid') return null
  const entitled = await requireEntitled(ctx)
  if (!entitled.ok) return entitled.result
  const vapid = ctx.vapid ?? null

  if (pathname === '/reminders/vapid' && method === 'GET') {
    if (!vapid) return { status: 503, body: { ok: false, error: 'reminders_unconfigured' } }
    return { status: 200, body: { ok: true, publicKey: vapid.publicKey } }
  }

  if (pathname === '/reminders' && method === 'GET') {
    const suppressed = await ctx.store.suppressedSet(ctx.envSuppress)
    if (suppressed.has(entitled.email)) {
      return { status: 200, body: { ok: true, enabled: false, suppressed: true, time: null, timeZone: null } }
    }
    const record = await ctx.store.get(entitled.email)
    return { status: 200, body: statusView(record) }
  }

  if (pathname === '/reminders' && method === 'POST') {
    if (ctx.body?.enabled === false) {
      await ctx.store.delete(entitled.email)
      return { status: 200, body: { ok: true, enabled: false } }
    }
    const suppressed = await ctx.store.suppressedSet(ctx.envSuppress)
    if (suppressed.has(entitled.email)) {
      await ctx.store.delete(entitled.email)
      return { status: 403, body: { ok: false, error: 'suppressed' } }
    }
    if (!vapid) return { status: 503, body: { ok: false, error: 'reminders_unconfigured' } }
    const time = parseReminderTime(ctx.body?.time)
    const timeZone = validTimeZone(ctx.body?.timeZone)
    const subscription = parseSubscription(ctx.body?.subscription)
    if (!time || !timeZone || !subscription) {
      return { status: 400, body: { ok: false, error: 'invalid_reminder' } }
    }
    const previous = await ctx.store.get(entitled.email)
    const keepSent =
      previous && previous.time === time && previous.timeZone === timeZone ? previous.lastSentLocalDate ?? null : null
    await ctx.store.put({
      email: entitled.email,
      time,
      timeZone,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      updatedAt: (ctx.now instanceof Date ? ctx.now : new Date()).toISOString(),
      lastSentLocalDate: keepSent,
    })
    return { status: 200, body: { ok: true, enabled: true, time, timeZone } }
  }

  return null
}

export async function dispatchDueReminders({ store, envSuppress, vapid, fetchFn = fetch, now = new Date() } = {}) {
  if (!store || !vapid) return []
  const suppressed = await store.suppressedSet(envSuppress)
  const records = await store.list()
  const results = []
  for (const record of records) {
    if (!record?.email) continue
    if (suppressed.has(record.email)) {
      results.push({ email: record.email, status: 'suppressed' })
      continue
    }
    if (!reminderIsDue(record, now)) {
      results.push({ email: record.email, status: 'not_due' })
      continue
    }
    const payload = reminderPayload()
    let sent
    try {
      sent = await sendWebPush({
        endpoint: record.endpoint,
        p256dh: record.p256dh,
        auth: record.auth,
        payload,
        vapid,
        fetchFn,
      })
    } catch {
      results.push({ email: record.email, status: 'failed' })
      continue
    }
    if (sent.gone) {
      await store.delete(record.email)
      results.push({ email: record.email, status: 'gone' })
      continue
    }
    if (!sent.ok) {
      results.push({ email: record.email, status: 'failed' })
      continue
    }
    const clock = localClock(now, record.timeZone)
    await store.put({ ...record, lastSentLocalDate: clock?.date ?? record.lastSentLocalDate ?? null })
    results.push({ email: record.email, status: 'sent' })
  }
  return results
}

export function memoryReminderStore(initial = {}) {
  const records = new Map()
  for (const record of initial.records ?? []) records.set(record.email, { ...record })
  let suppress = initial.suppress ?? ''
  return {
    async get(email) {
      const record = records.get(email)
      return record ? { ...record } : null
    },
    async put(record) {
      records.set(record.email, { ...record })
    },
    async delete(email) {
      records.delete(email)
    },
    async list() {
      return [...records.values()].map((record) => ({ ...record }))
    },
    async suppressedSet(envList) {
      return suppressedEmailSet(envList, suppress)
    },
    _setSuppress(value) {
      suppress = value
    },
  }
}

export function kvReminderStore(kv) {
  return {
    async get(email) {
      if (!kv || !email) return null
      const raw = await kv.get(REMINDER_PREFIX + email)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    },
    async put(record) {
      await kv.put(REMINDER_PREFIX + record.email, JSON.stringify(record))
    },
    async delete(email) {
      await kv.delete(REMINDER_PREFIX + email)
    },
    async list() {
      const out = []
      let cursor
      do {
        const page = await kv.list({ prefix: REMINDER_PREFIX, cursor })
        for (const key of page.keys || []) {
          const raw = await kv.get(key.name)
          if (!raw) continue
          try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') out.push(parsed)
          } catch {
            // Skip a corrupt record. Do not throw the rest of the dispatch away.
          }
        }
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      return out
    },
    async suppressedSet(envList) {
      let raw = ''
      try {
        raw = (await kv.get(SUPPRESS_KV_KEY)) || ''
      } catch {
        raw = ''
      }
      return suppressedEmailSet(envList, raw)
    },
  }
}
