/**
 * Purchase → unique redeem pass.
 * Shared by the Cloudflare Worker and the local Node API.
 * Never import this from the Vite app. The mint secret stays on the Worker.
 */

export const DEMO_TOKEN = 'DEMO-SARA-001'
export const PUBLIC_ORIGIN_DEFAULT = 'https://sara-pfilates.surge.sh'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_RE = /^SARA-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/
const BANNED_EXTERNAL_IDS = new Set(['undefined', 'null', 'none', 'nil', 'n/a', 'na', '0'])

export function normalizeToken(token) {
  return String(token ?? '').trim().toUpperCase()
}

export function normalizeEmail(email) {
  const value = String(email ?? '').trim().toLowerCase()
  if (!value || value.length > 320) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value
}

/** Kajabi transaction id. Lowercased so a Zapier retry hits the same pass. */
export function normalizeExternalId(value) {
  const id = String(value ?? '').trim().toLowerCase()
  if (!id || id.length > 128) return null
  if (BANNED_EXTERNAL_IDS.has(id)) return null
  if (id.includes('{{') || id.includes('}}')) return null
  if (!/^[a-z0-9._:-]+$/.test(id)) return null
  return id
}

export function publicRedeemOrigin(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return PUBLIC_ORIGIN_DEFAULT
  let url
  try {
    url = new URL(raw)
  } catch {
    return PUBLIC_ORIGIN_DEFAULT
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && local) return url.origin
  return PUBLIC_ORIGIN_DEFAULT
}

export function formatToken(bytes) {
  if (!bytes || bytes.length < 16) throw new Error('mint_entropy')
  let raw = ''
  for (let i = 0; i < 16; i++) raw += ALPHABET[bytes[i] % ALPHABET.length]
  return `SARA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

export function timingSafeEqualString(a, b) {
  const enc = new TextEncoder()
  const left = enc.encode(String(a ?? ''))
  const right = enc.encode(String(b ?? ''))
  const len = Math.max(left.length, right.length, 1)
  let diff = left.length === right.length ? 0 : 1
  for (let i = 0; i < len; i++) diff |= (left[i] || 0) ^ (right[i] || 0)
  return diff === 0
}

export function headerGetter(headers) {
  return (name) => {
    if (!headers) return ''
    if (typeof headers.get === 'function') return headers.get(name) || ''
    const value = headers[String(name).toLowerCase()]
    if (Array.isArray(value)) return value[0] || ''
    return value == null ? '' : String(value)
  }
}

export function authorizeMint(getHeader, secret) {
  const expected = String(secret ?? '')
  if (!expected || typeof getHeader !== 'function') return false
  const presented = []
  const auth = String(getHeader('authorization') || '')
  const bearer = auth.match(/^Bearer\s+(\S+)\s*$/i)
  if (bearer) presented.push(bearer[1])
  const alt = String(getHeader('x-redeem-mint-secret') || '').trim()
  if (alt) presented.push(alt)
  return presented.some((value) => timingSafeEqualString(value, expected))
}

export function sanitizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const token = normalizeToken(value.token)
  if (token === DEMO_TOKEN || !TOKEN_RE.test(token)) return null
  let email = null
  if (value.email != null && String(value.email).trim() !== '') {
    email = normalizeEmail(value.email)
    if (!email) return null
  }
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : ''
  if (!createdAt || createdAt.length > 40) return null
  let usedAt = null
  if (value.usedAt != null && value.usedAt !== '') {
    if (typeof value.usedAt !== 'string' || value.usedAt.length > 40) return null
    usedAt = value.usedAt
  }
  let externalId = null
  if (value.externalId != null && String(value.externalId).trim() !== '') {
    externalId = normalizeExternalId(value.externalId)
    if (!externalId) return null
  }
  return { token, email, createdAt, usedAt, externalId }
}

export function memoryRedeemStore(tokens = new Map(), external = new Map()) {
  return {
    async get(token) {
      const record = tokens.get(token)
      return record ? { ...record } : null
    },
    async put(token, record) {
      tokens.set(token, { ...record })
    },
    async getExternal(id) {
      return external.get(id) || null
    },
    async putExternal(id, token) {
      external.set(id, token)
    },
  }
}

export function kvRedeemStore(kv) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null
  return {
    async get(token) {
      const value = await kv.get(`redeem:${token}`, 'json')
      return sanitizeRecord(value)
    },
    async put(token, record) {
      await kv.put(`redeem:${token}`, JSON.stringify(record))
    },
    async getExternal(id) {
      const value = await kv.get(`ext:${id}`, 'text')
      const token = value ? normalizeToken(value) : ''
      return TOKEN_RE.test(token) ? token : null
    },
    async putExternal(id, token) {
      await kv.put(`ext:${id}`, token)
    },
  }
}

function redeemUrl(record, publicOrigin) {
  return `${publicRedeemOrigin(publicOrigin)}/r/${record.token}`
}

function mintPayload(record, publicOrigin, idempotent) {
  return {
    ok: true,
    token: record.token,
    email: record.email,
    createdAt: record.createdAt,
    usedAt: record.usedAt,
    externalId: record.externalId,
    idempotent,
    url: redeemUrl(record, publicOrigin),
  }
}

function defaultRandomBytes() {
  return crypto.getRandomValues(new Uint8Array(16))
}

export async function handleMint({
  store,
  secret,
  getHeader,
  body,
  publicOrigin,
  now = new Date().toISOString(),
  randomBytes,
} = {}) {
  const mintSecret = String(secret ?? '').trim()
  if (!mintSecret) return { status: 503, body: { ok: false, error: 'redeem_mint_unconfigured' } }
  if (!authorizeMint(getHeader, mintSecret)) return { status: 401, body: { ok: false, error: 'unauthorized' } }
  if (!store) return { status: 503, body: { ok: false, error: 'redeem_store_unconfigured' } }

  const rawEmail = body?.email
  const emailBlank = rawEmail == null || String(rawEmail).trim() === ''
  const email = emailBlank ? null : normalizeEmail(rawEmail)
  if (!emailBlank && !email) return { status: 400, body: { ok: false, error: 'invalid_email' } }

  let externalId = null
  const rawExternal = body?.externalId
  if (rawExternal != null && String(rawExternal).trim() !== '') {
    externalId = normalizeExternalId(rawExternal)
    if (!externalId) return { status: 400, body: { ok: false, error: 'invalid_external_id' } }
  }

  if (externalId) {
    const existingToken = await store.getExternal(externalId)
    if (existingToken) {
      const existing = await store.get(existingToken)
      if (existing) return { status: 200, body: mintPayload(existing, publicOrigin, true) }
    }
  }

  let token = null
  try {
    const nextBytes = randomBytes || defaultRandomBytes
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = formatToken(nextBytes())
      if (candidate === DEMO_TOKEN) continue
      const clash = await store.get(candidate)
      if (!clash) {
        token = candidate
        break
      }
    }
  } catch {
    token = null
  }
  if (!token) return { status: 503, body: { ok: false, error: 'mint_failed' } }

  const record = sanitizeRecord({
    token,
    email,
    createdAt: now,
    usedAt: null,
    externalId,
  })
  if (!record) return { status: 503, body: { ok: false, error: 'mint_failed' } }
  await store.put(record.token, record)
  if (externalId) await store.putExternal(externalId, record.token)
  return { status: 201, body: mintPayload(record, publicOrigin, false) }
}

export async function handleRedeem({ store, body, now = new Date().toISOString() } = {}) {
  const token = normalizeToken(body?.token)
  const email = normalizeEmail(body?.email)
  if (!token || !email) return { status: 400, body: { ok: false, reason: 'invalid' } }

  if (token === DEMO_TOKEN) {
    return { status: 200, body: { ok: true, token, email, demo: true } }
  }

  if (!store) return { status: 503, body: { ok: false, reason: 'redeem-unavailable' } }

  const record = await store.get(token)
  if (!record) return { status: 404, body: { ok: false, reason: 'unknown-token' } }
  if (record.email && record.email !== email) {
    return { status: 409, body: { ok: false, reason: 'email-mismatch' } }
  }

  const next = {
    ...record,
    email: record.email || email,
    usedAt: record.usedAt || now,
  }
  if (next.email !== record.email || next.usedAt !== record.usedAt) {
    await store.put(token, next)
  }
  return {
    status: 200,
    body: { ok: true, token: next.token, email: next.email, usedAt: next.usedAt },
  }
}

export async function dispatchRedeem(pathname, method, ctx) {
  if (method !== 'POST') return null
  if (pathname === '/redeem/mint') return handleMint(ctx)
  if (pathname === '/redeem') return handleRedeem(ctx)
  return null
}
