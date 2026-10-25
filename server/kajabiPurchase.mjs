/**
 * Kajabi purchase → Sara entitlement.
 * Shared by the Cloudflare Worker and the local Node API.
 * Never import this from the Vite app. Never send email from here.
 *
 * Dr C's Kajabi (Pro Annual) configures outbound webhooks under
 * Settings > Integrations & Webhooks > Webhooks. The form has an Event
 * and an Endpoint URL only. The events offered are Payment Succeeded and
 * Cart Purchase. There is no offer-granted event, and automations cannot
 * send webhooks. Granted or comped access does not fire these events.
 *
 * Payload shapes:
 * - Payment Succeeded: offer + member + payment_transaction.
 *   https://help.kajabi.com/en/articles/17175722-webhook-and-api-changes-with-multiple-order-bumps
 *   offer.id may be a comma-separated list when one charge covers several offers.
 * - Cart Purchase: order.order_items[].id (the offer), member, payment_transaction.
 *   https://help.kajabi.com/en/articles/17175721-outbound-webhook-data-reference
 * - Setup (no signature header; endpoint URL is the only field):
 *   https://help.kajabi.com/hc/en-us/articles/360037245374-How-to-Use-Webhooks-on-Kajabi
 *
 * Auth is the `key` query parameter compared to KAJABI_WEBHOOK_KEY.
 * Kajabi's webhook articles do not document a signature header, so this
 * endpoint does not invent one (a guessed HMAC would reject real deliveries).
 *
 * Known $149 offer ids (enabled only when listed in KAJABI_SARA_OFFER_IDS):
 *   2147989270 women's, 2149556914 men's.
 */

import { authorizeMint, handleMint, normalizeEmail, timingSafeEqualString } from './redeem.mjs'

export const KAJABI_OPEN_LIMIT = 8
export const KAJABI_OPEN_WINDOW_MS = 10 * 60 * 1000
export const KAJABI_EMAIL_PREFIX = 'kajabi:email:'
export const KAJABI_ORDER_PREFIX = 'kajabi:order:'

const ACCEPTED_EVENTS = new Set(['', 'payment_succeeded', 'cart_purchase', 'cart_purchased'])
const MAX_ORDER_KEYS = 8

export function rawQueryParam(search, name) {
  const query = String(search ?? '').replace(/^\?/, '')
  const wanted = String(name)
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const rawKey = eq === -1 ? part : part.slice(0, eq)
    let key = rawKey
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
    } catch {
      key = rawKey
    }
    if (key !== wanted) continue
    const rawValue = eq === -1 ? '' : part.slice(eq + 1)
    const preserved = rawValue.replace(/\+/g, '%2B')
    try {
      return decodeURIComponent(preserved)
    } catch {
      return rawValue
    }
  }
  return ''
}

/** Kajabi's {{ email }} merge tag may leave a plus unencoded, which arrives as a space. */
export function normalizeOpenEmailInput(value) {
  const trimmed = String(value ?? '').trim().replace(/ /g, '+')
  return normalizeEmail(trimmed)
}

export function parseOfferAllowlist(value) {
  const ids = []
  const seen = new Set()
  for (const part of String(value ?? '').split(',')) {
    const id = normalizeOfferId(part)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function normalizeOfferId(value) {
  const id = String(value ?? '').trim()
  if (!/^\d{1,20}$/.test(id)) return null
  return id
}

export function normalizeOrderKey(value) {
  const id = String(value ?? '').trim().toLowerCase()
  if (!id || id.length > 128) return null
  if (id.includes('{{') || id.includes('}}')) return null
  if (!/^[a-z0-9._:-]+$/.test(id)) return null
  return id
}

function normalizeEvent(body) {
  const raw = body?.event ?? body?.Event ?? ''
  return String(raw).trim().toLowerCase().replace(/[\s.-]+/g, '_')
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function addOfferId(target, seen, value) {
  const text = String(value ?? '').trim()
  if (!text) return
  for (const part of text.split(',')) {
    const id = normalizeOfferId(part)
    if (!id || seen.has(id)) continue
    seen.add(id)
    target.push(id)
  }
}

function collectOfferIds(body) {
  const ids = []
  const seen = new Set()
  const offer = asObject(body.offer)
  if (offer) addOfferId(ids, seen, offer.id)
  addOfferId(ids, seen, body.offer_id)
  const nested = asObject(body.order)
  const items = Array.isArray(nested?.order_items) ? nested.order_items : Array.isArray(body.order_items) ? body.order_items : []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const type = item.type == null ? '' : String(item.type).trim().toLowerCase()
    if (type && type !== 'offer' && type !== 'offers') continue
    addOfferId(ids, seen, item.id)
  }
  return ids
}

function addOrderKey(target, seen, value) {
  if (target.length >= MAX_ORDER_KEYS) return
  const id = normalizeOrderKey(value)
  if (!id || seen.has(id)) return
  seen.add(id)
  target.push(id)
}

function collectOrderKeys(body) {
  const keys = []
  const seen = new Set()
  const order = asObject(body.order)
  const payment = asObject(body.payment_transaction)
  const transaction = asObject(body.transaction)
  addOrderKey(keys, seen, order?.id)
  addOrderKey(keys, seen, payment?.id)
  addOrderKey(keys, seen, transaction?.transaction_id)
  addOrderKey(keys, seen, transaction?.id)
  addOrderKey(keys, seen, body.order_id)
  return keys
}

function preferredOrderId(body) {
  const order = asObject(body.order)
  const payment = asObject(body.payment_transaction)
  const transaction = asObject(body.transaction)
  return (
    normalizeOrderKey(order?.id) ||
    normalizeOrderKey(payment?.id) ||
    normalizeOrderKey(transaction?.transaction_id) ||
    normalizeOrderKey(transaction?.id) ||
    normalizeOrderKey(body.order_id) ||
    null
  )
}

function personName(source) {
  const record = asObject(source)
  if (!record) return null
  const name = String(record.name ?? '').trim()
  if (name) return name.slice(0, 200)
  const first = String(record.first_name ?? '').trim()
  const last = String(record.last_name ?? '').trim()
  const joined = [first, last].filter(Boolean).join(' ')
  return joined ? joined.slice(0, 200) : null
}

/**
 * Pull email, name, offer ids, and order keys from a Payment Succeeded or
 * Cart Purchase body. Returns null when `body` is not a JSON object.
 * `email` may be null when the address is missing or not usable.
 */
export function parseKajabiNotice(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const member = asObject(body.member) || asObject(body.customer) || asObject(body.contact)
  const email = normalizeEmail(member?.email ?? body.email)
  const name = personName(member) || personName(body)
  return {
    event: normalizeEvent(body),
    email,
    name,
    offerIds: collectOfferIds(body),
    orderKeys: collectOrderKeys(body),
    orderId: preferredOrderId(body),
  }
}

export function parseJsonObject(text) {
  const raw = String(text ?? '')
  if (raw.length > 100_000) return { error: 'invalid_json' }
  if (!raw.trim()) return { body: {} }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'invalid_json' }
    return { body: parsed }
  } catch {
    return { error: 'invalid_json' }
  }
}

function webhookAuthorized(presentedKey, expectedKey) {
  const expected = String(expectedKey ?? '').trim()
  if (!expected) return { ok: false, status: 503, error: 'kajabi_webhook_unconfigured' }
  const presented = String(presentedKey ?? '').trim()
  if (!timingSafeEqualString(presented, expected)) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true }
}

export function memoryEntitlementStore() {
  const emails = new Map()
  const orders = new Map()
  return {
    emails,
    orders,
    async getEmail(email) {
      const row = emails.get(email)
      return row ? { ...row } : null
    },
    async findOrder(keys) {
      for (const key of keys || []) {
        const email = orders.get(key)
        if (!email) continue
        const row = emails.get(email)
        if (row) return { ...row }
      }
      return null
    },
    async put(record, orderKeys) {
      emails.set(record.email, { ...record })
      for (const key of orderKeys || []) {
        if (!orders.has(key)) orders.set(key, record.email)
      }
    },
    async linkOrders(email, orderKeys) {
      if (!emails.has(email)) return
      for (const key of orderKeys || []) {
        if (!orders.has(key)) orders.set(key, email)
      }
    },
  }
}

export function kvEntitlementStore(kv) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null
  return {
    async getEmail(email) {
      const value = await kv.get(`${KAJABI_EMAIL_PREFIX}${email}`, 'json')
      return sanitizeEntitlement(value)
    },
    async findOrder(keys) {
      for (const key of keys || []) {
        const email = await kv.get(`${KAJABI_ORDER_PREFIX}${key}`, 'text')
        if (!email) continue
        const value = await kv.get(`${KAJABI_EMAIL_PREFIX}${email}`, 'json')
        const row = sanitizeEntitlement(value)
        if (row) return row
      }
      return null
    },
    async put(record, orderKeys) {
      await kv.put(`${KAJABI_EMAIL_PREFIX}${record.email}`, JSON.stringify(record))
      for (const key of orderKeys || []) {
        const existing = await kv.get(`${KAJABI_ORDER_PREFIX}${key}`, 'text')
        if (!existing) await kv.put(`${KAJABI_ORDER_PREFIX}${key}`, record.email)
      }
    },
    async linkOrders(email, orderKeys) {
      const current = await kv.get(`${KAJABI_EMAIL_PREFIX}${email}`, 'json')
      if (!sanitizeEntitlement(current)) return
      for (const key of orderKeys || []) {
        const existing = await kv.get(`${KAJABI_ORDER_PREFIX}${key}`, 'text')
        if (!existing) await kv.put(`${KAJABI_ORDER_PREFIX}${key}`, email)
      }
    },
  }
}

function sanitizeEntitlement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const email = normalizeEmail(value.email)
  if (!email) return null
  const offerId = value.offerId === 'admin' ? 'admin' : normalizeOfferId(value.offerId)
  if (!offerId) return null
  let orderId = null
  if (value.orderId != null && String(value.orderId).trim() !== '') {
    orderId = normalizeOrderKey(value.orderId)
    if (!orderId) return null
  }
  const ts = typeof value.ts === 'string' ? value.ts : ''
  if (!ts || ts.length > 40) return null
  return { email, offerId, orderId, ts }
}

function matchedOffer(offerIds, allowlist) {
  const allowed = new Set(allowlist)
  return offerIds.find((id) => allowed.has(id)) || null
}

export async function handleKajabiPurchase({
  store,
  expectedKey,
  presentedKey,
  offerIds,
  rawBody,
  now = new Date().toISOString(),
} = {}) {
  const auth = webhookAuthorized(presentedKey, expectedKey)
  if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } }
  if (!store) return { status: 503, body: { ok: false, error: 'kajabi_store_unconfigured' } }
  const allowlist = parseOfferAllowlist(offerIds)
  if (!allowlist.length) return { status: 503, body: { ok: false, error: 'kajabi_offers_unconfigured' } }

  const json = parseJsonObject(rawBody)
  if (json.error) return { status: 400, body: { ok: false, error: 'invalid_json' } }
  const notice = parseKajabiNotice(json.body)
  if (!notice) return { status: 400, body: { ok: false, error: 'invalid_payload' } }
  if (!ACCEPTED_EVENTS.has(notice.event)) {
    return { status: 200, body: { ok: true, ignored: true, reason: 'event' } }
  }
  if (!notice.email) return { status: 400, body: { ok: false, error: 'invalid_email' } }

  const existingOrder = await store.findOrder(notice.orderKeys)
  if (existingOrder) {
    await store.linkOrders(existingOrder.email, notice.orderKeys)
    return { status: 200, body: { ok: true, granted: true, idempotent: true } }
  }

  const offerId = matchedOffer(notice.offerIds, allowlist)
  if (!offerId) return { status: 200, body: { ok: true, ignored: true, reason: 'offer' } }

  const existingEmail = await store.getEmail(notice.email)
  if (existingEmail) {
    await store.linkOrders(existingEmail.email, notice.orderKeys)
    return { status: 200, body: { ok: true, granted: true, idempotent: true } }
  }

  const record = {
    email: notice.email,
    offerId,
    orderId: notice.orderId,
    ts: now,
  }
  await store.put(record, notice.orderKeys)
  return { status: 201, body: { ok: true, granted: true, idempotent: false } }
}

async function hashOpenIp(ip) {
  const raw = String(ip || 'unknown').trim() || 'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sara-kajabi-open:v1:${raw}`))
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

export async function buyerExternalId(email) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`sara-kajabi-buyer:v1:${email}`),
  )
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < 20; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return `kajabi:${hex}`
}

function openReady(token, email) {
  return { status: 200, body: { ok: true, ready: true, token, email } }
}

function openWaiting() {
  return { status: 200, body: { ok: true, ready: false } }
}

export async function handleKajabiOpen({
  entitlementStore,
  redeemStore,
  counterStore,
  secret,
  rawBody,
  ip,
  now = new Date().toISOString(),
  nowMs = Date.now(),
  publicOrigin,
  limit = KAJABI_OPEN_LIMIT,
  windowMs = KAJABI_OPEN_WINDOW_MS,
  randomBytes,
} = {}) {
  const mintSecret = String(secret ?? '').trim()
  if (!mintSecret) return { status: 503, body: { ok: false, error: 'redeem_mint_unconfigured' } }
  if (!entitlementStore || !redeemStore || !counterStore) {
    return { status: 503, body: { ok: false, error: 'kajabi_store_unconfigured' } }
  }

  const window = Number(windowMs) > 0 ? Number(windowMs) : KAJABI_OPEN_WINDOW_MS
  const cap = Number(limit) > 0 ? Number(limit) : KAJABI_OPEN_LIMIT
  const bucket = Math.floor(Number(nowMs) / window)
  const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * window - Number(nowMs)) / 1000))
  const hash = await hashOpenIp(ip)
  const rateKey = `rl:kajabi:open:${hash}:${bucket}`
  const current = Number.parseInt(String((await counterStore.get(rateKey)) ?? '0'), 10)
  const used = Number.isFinite(current) && current > 0 ? current : 0
  if (used >= cap) {
    return { status: 429, retryAfter, body: { ok: false, error: 'rate_limited' } }
  }
  const ttlSeconds = Math.max(60, Math.ceil((window * 2) / 1000))
  await counterStore.put(rateKey, String(used + 1), ttlSeconds)

  const json = parseJsonObject(rawBody)
  if (json.error) return openWaiting()
  const email = normalizeOpenEmailInput(json.body?.email ?? json.body?.e)
  if (!email) return openWaiting()

  const entitlement = await entitlementStore.getEmail(email)
  if (!entitlement) return openWaiting()

  const externalId = await buyerExternalId(email)
  const minted = await handleMint({
    store: redeemStore,
    secret: mintSecret,
    getHeader: (name) => (String(name).toLowerCase() === 'authorization' ? `Bearer ${mintSecret}` : ''),
    body: { email, externalId },
    publicOrigin,
    now,
    randomBytes,
  })
  const token = minted?.body?.token
  if (!token) return { status: 503, body: { ok: false, error: 'open_unavailable' } }
  return openReady(token, email)
}

export async function handleKajabiGrant({
  store,
  secret,
  getHeader,
  rawBody,
  now = new Date().toISOString(),
} = {}) {
  const mintSecret = String(secret ?? '').trim()
  if (!mintSecret) return { status: 503, body: { ok: false, error: 'redeem_mint_unconfigured' } }
  if (!authorizeMint(getHeader, mintSecret)) return { status: 401, body: { ok: false, error: 'unauthorized' } }
  if (!store) return { status: 503, body: { ok: false, error: 'kajabi_store_unconfigured' } }

  const json = parseJsonObject(rawBody)
  if (json.error) return { status: 400, body: { ok: false, error: 'invalid_json' } }
  const email = normalizeEmail(json.body?.email)
  if (!email) return { status: 400, body: { ok: false, error: 'invalid_email' } }

  let offerId = 'admin'
  if (json.body?.offerId != null && String(json.body.offerId).trim() !== '') {
    offerId = normalizeOfferId(json.body.offerId)
    if (!offerId) return { status: 400, body: { ok: false, error: 'invalid_offer' } }
  }
  let orderId = null
  if (json.body?.orderId != null && String(json.body.orderId).trim() !== '') {
    orderId = normalizeOrderKey(json.body.orderId)
    if (!orderId) return { status: 400, body: { ok: false, error: 'invalid_order' } }
  }

  const existing = await store.getEmail(email)
  if (existing) {
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: true,
        email: existing.email,
        offerId: existing.offerId,
        orderId: existing.orderId,
        ts: existing.ts,
      },
    }
  }

  const record = { email, offerId, orderId, ts: now }
  await store.put(record, orderId ? [orderId] : [])
  return {
    status: 201,
    body: { ok: true, idempotent: false, email, offerId, orderId, ts: now },
  }
}

export async function dispatchKajabi(pathname, method, ctx) {
  if (method !== 'POST') return null
  if (pathname === '/kajabi/purchase') return handleKajabiPurchase(ctx)
  if (pathname === '/kajabi/open') return handleKajabiOpen(ctx)
  if (pathname === '/kajabi/grant') return handleKajabiGrant(ctx)
  return null
}
