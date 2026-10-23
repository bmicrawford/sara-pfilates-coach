/**
 * Public demo pass gate for paid Ask Sara endpoints.
 *
 * DEMO-SARA-001 is voice-only (no D-ID) and rate-limited.
 * Counters are short-TTL keys in the existing REDEEM_TOKENS KV binding.
 * No new namespace and no new secret. Do not log passes, IPs, or secrets.
 *
 * Guardrails (server/saraGuardrails.mjs) and research
 * (server/saraKnowledge.mjs) are not applied here. Ask Sara still builds
 * the system prompt with those blocks first.
 */

import { DEMO_TOKEN, TOKEN_RE, normalizeToken } from './redeem.mjs'
import { isTalkPath } from './talkSara.mjs'

export const SARA_BUSY_MESSAGE = 'Sara is busy, please try again in a bit.'
export const UNKNOWN_PASS_MESSAGE = "That pass isn't recognized."
export const PASS_REQUIRED_MESSAGE = 'Open your Sara link again, then ask.'
export const DEMO_VOICE_ONLY_MESSAGE = 'This demo keeps Sara’s portrait still and uses voice only.'

/** Configurable demo-pass cost limits. Change these constants, then redeploy the Worker. */
export const DEMO_LIMITS = {
  askPerIpPerHour: 20,
  speakPerIpPerHour: 20,
  askPerIpPerDay: 60,
  speakPerIpPerDay: 60,
  globalAsksPerDay: 3000,
  globalSpeaksPerDay: 3000,
}

export const DEMO_HOUR_TTL_SECONDS = 2 * 60 * 60
export const DEMO_DAY_TTL_SECONDS = 2 * 24 * 60 * 60

export function paidEndpoint(method, pathname) {
  const verb = String(method || '').toUpperCase()
  const path = String(pathname || '')
  if (verb === 'POST' && path === '/ask') return 'ask'
  if (verb === 'POST' && path === '/speak') return 'speak'
  if (verb === 'POST' && path === '/stream') return 'stream'
  if (verb === 'POST' && path === '/talk') return 'talk'
  if (verb === 'GET' && isTalkPath(path)) return 'talk'
  return null
}

export function passFromParts({ body, header, query } = {}) {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const raw = record.pass ?? header ?? query ?? record.token ?? ''
  return normalizeToken(raw)
}

export function clientIpFromHeaders(headers, fallback = 'unknown') {
  const read = (name) => {
    if (!headers) return ''
    if (typeof headers.get === 'function') return headers.get(name) || ''
    const value = headers[String(name).toLowerCase()]
    if (Array.isArray(value)) return value[0] || ''
    return value == null ? '' : String(value)
  }
  const cf = String(read('cf-connecting-ip') || '').trim()
  if (cf) return cf
  const forwarded = String(read('x-forwarded-for') || '')
    .split(',')[0]
    .trim()
  if (forwarded) return forwarded
  return fallback || 'unknown'
}

export function hourBucket(nowMs) {
  return Math.floor(Number(nowMs) / 3_600_000)
}

export function dayBucket(nowMs) {
  return new Date(Number(nowMs)).toISOString().slice(0, 10)
}

export function secondsUntilNextHour(nowMs) {
  const now = Number(nowMs)
  const next = (Math.floor(now / 3_600_000) + 1) * 3_600_000
  return Math.max(1, Math.ceil((next - now) / 1000))
}

export function secondsUntilNextUtcDay(nowMs) {
  const now = new Date(Number(nowMs))
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

export async function demoIpHash(ip) {
  const raw = String(ip || 'unknown').trim() || 'unknown'
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`sara-demo-rl:v1:${raw}`),
  )
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

export function memoryCounterStore() {
  const rows = new Map()
  return {
    rows,
    async get(key) {
      const row = rows.get(key)
      return row ? row.value : null
    },
    async put(key, value, ttlSeconds) {
      rows.set(key, { value: String(value), ttlSeconds })
    },
  }
}

/** Short-TTL counters in the existing REDEEM_TOKENS namespace. Prefix `rl:demo:`. */
export function kvCounterStore(kv) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null
  return {
    async get(key) {
      const value = await kv.get(key, 'text')
      return value == null ? null : String(value)
    },
    async put(key, value, ttlSeconds) {
      const ttl = Math.max(60, Math.floor(Number(ttlSeconds) || 60))
      await kv.put(key, String(value), { expirationTtl: ttl })
    },
  }
}

function deny(status, error, message, extra = {}) {
  return {
    allow: false,
    status,
    retryAfter: extra.retryAfter,
    body: {
      ok: false,
      error,
      message,
      reply: message,
      ...(extra.scope ? { scope: extra.scope } : {}),
    },
  }
}

export function denialExtraHeaders(decision) {
  if (!decision || decision.allow || !decision.retryAfter) return {}
  return { 'Retry-After': String(decision.retryAfter) }
}

function capsFor(endpoint, limits) {
  if (endpoint === 'ask') {
    return {
      perIpPerHour: limits.askPerIpPerHour,
      perIpPerDay: limits.askPerIpPerDay,
      globalPerDay: limits.globalAsksPerDay,
    }
  }
  return {
    perIpPerHour: limits.speakPerIpPerHour,
    perIpPerDay: limits.speakPerIpPerDay,
    globalPerDay: limits.globalSpeaksPerDay,
  }
}

async function readCount(store, key) {
  const raw = await store.get(key)
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function counterKey(endpoint, kind, hash, bucket) {
  if (kind === 'global') return `rl:demo:${endpoint}:g:${bucket}`
  return `rl:demo:${endpoint}:${kind}:${hash}:${bucket}`
}

async function consumeDemoLimit({ counterStore, endpoint, ip, nowMs, limits }) {
  const caps = capsFor(endpoint, limits)
  const hash = await demoIpHash(ip)
  const hour = hourBucket(nowMs)
  const day = dayBucket(nowMs)
  const hourKey = counterKey(endpoint, 'h', hash, hour)
  const dayKey = counterKey(endpoint, 'd', hash, day)
  const globalKey = counterKey(endpoint, 'global', hash, day)

  const hourCount = await readCount(counterStore, hourKey)
  if (hourCount >= caps.perIpPerHour) {
    return deny(429, 'rate_limited', SARA_BUSY_MESSAGE, {
      retryAfter: secondsUntilNextHour(nowMs),
      scope: 'ip_hour',
    })
  }
  const dayCount = await readCount(counterStore, dayKey)
  if (dayCount >= caps.perIpPerDay) {
    return deny(429, 'rate_limited', SARA_BUSY_MESSAGE, {
      retryAfter: secondsUntilNextUtcDay(nowMs),
      scope: 'ip_day',
    })
  }
  const globalCount = await readCount(counterStore, globalKey)
  if (globalCount >= caps.globalPerDay) {
    return deny(429, 'rate_limited', SARA_BUSY_MESSAGE, {
      retryAfter: secondsUntilNextUtcDay(nowMs),
      scope: 'global_day',
    })
  }

  await counterStore.put(hourKey, String(hourCount + 1), DEMO_HOUR_TTL_SECONDS)
  await counterStore.put(dayKey, String(dayCount + 1), DEMO_DAY_TTL_SECONDS)
  await counterStore.put(globalKey, String(globalCount + 1), DEMO_DAY_TTL_SECONDS)
  return null
}

export async function authorizePaidRequest({
  method,
  pathname,
  pass,
  redeemStore,
  counterStore,
  ip = 'unknown',
  nowMs = Date.now(),
  limits = DEMO_LIMITS,
} = {}) {
  const endpoint = paidEndpoint(method, pathname)
  if (!endpoint) return deny(404, 'not_found', 'Not found')

  const token = normalizeToken(pass)
  if (!token) return deny(401, 'pass_required', PASS_REQUIRED_MESSAGE)

  let kind = null
  if (token === DEMO_TOKEN) {
    kind = 'demo'
  } else if (!TOKEN_RE.test(token)) {
    return deny(403, 'unknown_pass', UNKNOWN_PASS_MESSAGE)
  } else if (!redeemStore || typeof redeemStore.get !== 'function') {
    return deny(503, 'pass_check_unavailable', SARA_BUSY_MESSAGE)
  } else {
    let record = null
    try {
      record = await redeemStore.get(token)
    } catch {
      return deny(503, 'pass_check_unavailable', SARA_BUSY_MESSAGE)
    }
    if (!record) return deny(403, 'unknown_pass', UNKNOWN_PASS_MESSAGE)
    kind = record.multiUse ? 'class' : 'paid'
  }

  if (kind === 'demo' && (endpoint === 'stream' || endpoint === 'talk')) {
    return deny(403, 'demo_voice_only', DEMO_VOICE_ONLY_MESSAGE)
  }

  if (kind === 'demo' && (endpoint === 'ask' || endpoint === 'speak')) {
    if (!counterStore || typeof counterStore.get !== 'function') {
      return deny(503, 'rate_limit_unavailable', SARA_BUSY_MESSAGE)
    }
    try {
      const limited = await consumeDemoLimit({ counterStore, endpoint, ip, nowMs, limits })
      if (limited) return limited
    } catch {
      return deny(503, 'rate_limit_unavailable', SARA_BUSY_MESSAGE)
    }
  }

  return {
    allow: true,
    pass: { token, kind, voiceOnly: kind === 'demo' },
  }
}
