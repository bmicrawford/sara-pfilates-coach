import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryCounterStore } from './demoGate.mjs'
import { createFileEntitlementStore } from './kajabiFileStore.mjs'
import {
  handleKajabiGrant,
  handleKajabiOpen,
  handleKajabiPurchase,
  kvEntitlementStore,
  memoryEntitlementStore,
  normalizeOpenEmailInput,
  parseKajabiNotice,
  rawQueryParam,
} from './kajabiPurchase.mjs'
import { handleRedeem, headerGetter, memoryRedeemStore } from './redeem.mjs'
import askWorker from '../worker/src/index.js'

/**
 * Payment Succeeded shape: Kajabi, "Webhook and API changes with Multiple Order Bumps",
 * "Before (single offer, single transaction)":
 * https://help.kajabi.com/en/articles/17175722-webhook-and-api-changes-with-multiple-order-bumps
 * offer.id is the women's $149 offer. Amounts stay as in the published sample.
 * The help page obfuscates the sample email; the sample name is Jane Smith.
 *
 * Cart Purchase fields: "Outbound webhook data reference":
 * https://help.kajabi.com/en/articles/17175721-outbound-webhook-data-reference
 * Kajabi does not publish the Cart Purchase event string. The parser accepts
 * `cart.purchase` and a body with no event. Setup (endpoint URL only, no signature):
 * https://help.kajabi.com/hc/en-us/articles/360037245374-How-to-Use-Webhooks-on-Kajabi
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const KEY = 'kajabi-webhook-key-0123456789abcdef'
const SECRET = 'test-mint-secret-0123456789abcdef'
const OFFERS = '2147989270, 2149556914'
const NOW = '2026-10-25T18:00:00.000Z'
const NOW_MS = Date.parse('2026-10-25T18:00:00.000Z')

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

function headers(map) {
  return headerGetter(map)
}

function paymentSucceeded(overrides = {}) {
  return {
    offer: {
      id: 2147989270,
      title: 'Main Course',
      internal_title: 'Main Course - Internal',
      type: 'one-time',
      ...overrides.offer,
    },
    member: {
      id: 99999,
      email: 'jane.smith@example.com',
      name: 'Jane Smith',
      first_name: 'Jane',
      last_name: 'Smith',
      ...overrides.member,
    },
    payment_transaction: {
      id: 55555,
      created_at: '2025-04-01T10:00:00Z',
      currency: 'USD',
      amount_paid: 5000,
      amount_paid_decimal: 50.0,
      subtotal: 5000,
      subtotal_decimal: 50.0,
      discount_amount: 0,
      discount_amount_decimal: 0.0,
      coupon_code: null,
      payment_method: 'visa',
      payment_processor: 'Kajabi Payments',
      ...overrides.payment_transaction,
    },
    ...(overrides.event ? { event: overrides.event } : {}),
  }
}

function cartPurchase(overrides = {}) {
  return {
    event: overrides.event === undefined ? 'cart.purchase' : overrides.event,
    order: {
      id: 9001,
      source: 'cart',
      order_number: '1042',
      order_items: overrides.order_items || [
        {
          type: 'Offer',
          id: 2147989270,
          title: 'PfilAtes for Women',
          internal_title: 'Women $149',
          quantity: 1,
          unit_cost: 14900,
          total_amount: 14900,
        },
      ],
    },
    member: {
      id: 99999,
      email: 'jane.smith@example.com',
      name: 'Jane Smith',
      first_name: 'Jane',
      last_name: 'Smith',
      ...(overrides.member || {}),
    },
    payment_transaction: {
      id: 55555,
      created_at: '2025-04-01T10:00:00Z',
      currency: 'USD',
      amount_paid: 14900,
      payment_processor: 'Kajabi Payments',
      payment_method: 'visa',
      ...(overrides.payment_transaction || {}),
    },
  }
}

function purchase(store, body, extra = {}) {
  return handleKajabiPurchase({
    store,
    expectedKey: KEY,
    presentedKey: KEY,
    offerIds: OFFERS,
    rawBody: JSON.stringify(body),
    now: NOW,
    ...extra,
  })
}

const parsedPayment = parseKajabiNotice(paymentSucceeded())
assert(
  parsedPayment?.email === 'jane.smith@example.com' &&
    parsedPayment?.name === 'Jane Smith' &&
    parsedPayment?.offerIds.join(',') === '2147989270' &&
    parsedPayment?.orderId === '55555' &&
    parsedPayment?.orderKeys.includes('55555'),
  'payment succeeded sample parses email, name, offer id, and transaction id',
)
const parsedCart = parseKajabiNotice(cartPurchase())
assert(
  parsedCart?.email === 'jane.smith@example.com' &&
    parsedCart?.offerIds.join(',') === '2147989270' &&
    parsedCart?.orderKeys.includes('9001') &&
    parsedCart?.orderKeys.includes('55555') &&
    parsedCart?.orderId === '9001',
  'cart purchase sample parses the offer id from order_items and the order id',
)
const multi = parseKajabiNotice(
  paymentSucceeded({ offer: { id: '2147989270, 22222, 33333', title: 'Main Course,Bump,Bump' } }),
)
assert(
  multi?.offerIds.join(',') === '2147989270,22222,33333',
  'comma-separated Payment Succeeded offer ids are split',
)
assert(normalizeOpenEmailInput('  Jane Doe@Example.com ') === 'jane+doe@example.com', 'a space in the open email is a plus')
assert(normalizeOpenEmailInput('jane+doe@example.com') === 'jane+doe@example.com', 'an encoded plus stays a plus')
assert(rawQueryParam('?key=ab%2Bcd&x=1', 'key') === 'ab+cd', 'webhook key preserves an encoded plus')
assert(rawQueryParam('?key=ab+cd', 'key') === 'ab+cd', 'webhook key preserves a raw plus')

const deniedStore = memoryEntitlementStore()
const denied = await purchase(deniedStore, paymentSucceeded(), { presentedKey: 'wrong-webhook-key' })
assert(denied.status === 401 && denied.body.error === 'unauthorized' && deniedStore.emails.size === 0, 'wrong webhook key is rejected')
const missingKey = await purchase(deniedStore, paymentSucceeded(), { presentedKey: '' })
assert(missingKey.status === 401 && deniedStore.emails.size === 0, 'missing webhook key is rejected')
const bodyKey = await handleKajabiPurchase({
  store: deniedStore,
  expectedKey: KEY,
  presentedKey: '',
  offerIds: OFFERS,
  rawBody: JSON.stringify({ ...paymentSucceeded(), key: KEY }),
  now: NOW,
})
assert(bodyKey.status === 401 && deniedStore.emails.size === 0, 'a key in the JSON body is not the webhook secret')
const shortKey = await purchase(deniedStore, paymentSucceeded(), { presentedKey: 'x' })
assert(shortKey.status === 401, 'a different-length key is rejected')
const unconfigured = await purchase(deniedStore, paymentSucceeded(), { expectedKey: '' })
assert(unconfigured.status === 503 && unconfigured.body.error === 'kajabi_webhook_unconfigured', 'webhook without a secret is closed')
const noOffers = await purchase(memoryEntitlementStore(), paymentSucceeded(), { offerIds: '' })
assert(noOffers.status === 503 && noOffers.body.error === 'kajabi_offers_unconfigured', 'webhook without an offer allowlist is closed')
const badJson = await handleKajabiPurchase({
  store: deniedStore,
  expectedKey: KEY,
  presentedKey: KEY,
  offerIds: OFFERS,
  rawBody: '{',
  now: NOW,
})
assert(badJson.status === 400 && badJson.body.error === 'invalid_json', 'a bad JSON body is rejected after the key matches')
const badJsonHidden = await handleKajabiPurchase({
  store: deniedStore,
  expectedKey: KEY,
  presentedKey: 'nope',
  offerIds: OFFERS,
  rawBody: '{',
  now: NOW,
})
assert(badJsonHidden.status === 401, 'a bad key fails before the body is judged')

const store = memoryEntitlementStore()
const granted = await purchase(store, paymentSucceeded())
const saved = await store.getEmail('jane.smith@example.com')
assert(granted.status === 201 && granted.body.granted === true && granted.body.idempotent === false, 'payment succeeded grants an entitlement')
assert(
  saved?.email === 'jane.smith@example.com' &&
    saved?.offerId === '2147989270' &&
    saved?.orderId === '55555' &&
    saved?.ts === NOW &&
    !JSON.stringify(saved).includes('Jane Smith') &&
    !JSON.stringify(granted.body).includes(KEY) &&
    !JSON.stringify(granted.body).includes('jane.smith'),
  'entitlement stores email, offer id, order id, and ts',
)
const replay = await purchase(store, paymentSucceeded({ event: 'payment.succeeded' }), { now: '2026-10-26T00:00:00.000Z' })
const afterReplay = await store.getEmail('jane.smith@example.com')
assert(
  replay.status === 200 && replay.body.idempotent === true && JSON.stringify(afterReplay) === JSON.stringify(saved),
  'a repeat Payment Succeeded is idempotent',
)

const cart = await purchase(store, cartPurchase(), { now: '2026-10-26T01:00:00.000Z' })
const afterCart = await store.getEmail('jane.smith@example.com')
assert(
  cart.status === 200 &&
    cart.body.idempotent === true &&
    store.emails.size === 1 &&
    JSON.stringify(afterCart) === JSON.stringify(saved) &&
    store.orders.get('9001') === 'jane.smith@example.com' &&
    store.orders.get('55555') === 'jane.smith@example.com',
  'Cart Purchase for the same transaction is the same entitlement',
)

const otherOffer = memoryEntitlementStore()
const ignoredOffer = await purchase(otherOffer, paymentSucceeded({ offer: { id: 11111, title: 'Other' } }))
assert(
  ignoredOffer.status === 200 &&
    ignoredOffer.body.ignored === true &&
    ignoredOffer.body.reason === 'offer' &&
    otherOffer.emails.size === 0 &&
    otherOffer.orders.size === 0,
  'an offer outside KAJABI_SARA_OFFER_IDS is ignored',
)
const mensOnly = await purchase(otherOffer, paymentSucceeded(), { offerIds: '2149556914' })
assert(mensOnly.body.reason === 'offer' && otherOffer.emails.size === 0, 'the women’s offer stays off when only the men’s id is enabled')
const laterCart = await purchase(otherOffer, cartPurchase())
assert(laterCart.status === 201 && otherOffer.emails.size === 1, 'a matching Cart Purchase still grants when the earlier event was ignored')

const commaStore = memoryEntitlementStore()
const commaGrant = await purchase(
  commaStore,
  paymentSucceeded({
    offer: { id: '11111,2149556914,33333', title: 'Other,Men,Bump', type: 'one-time,one-time,one-time' },
    member: { email: 'mens@example.com', name: 'Alex Kim' },
    payment_transaction: { id: 777 },
  }),
  { offerIds: '2149556914' },
)
const mens = await commaStore.getEmail('mens@example.com')
assert(
  commaGrant.status === 201 && mens?.offerId === '2149556914',
  'a comma-separated offer id grants when one id is enabled',
)

const form = await purchase(store, {
  event: 'form_submission',
  email: 'jane.smith@example.com',
  offer: { id: 2147989270 },
})
assert(form.status === 200 && form.body.reason === 'event' && store.emails.size === 1, 'a form submission event does not grant')

const ui = memoryEntitlementStore()
const payWomen = await purchase(ui, paymentSucceeded({
  event: 'payment.succeeded',
  offer: { id: 2147989270, title: 'PfilAtes for Women', type: 'one-time' },
  member: { email: 'pay.women@example.com', name: 'Pay Women' },
  payment_transaction: { id: 88001 },
}))
const payMen = await purchase(ui, paymentSucceeded({
  event: 'payment.succeeded',
  offer: { id: 2149556914, title: 'PfilAtes for Men', type: 'one-time' },
  member: { email: 'pay.men@example.com', name: 'Pay Men' },
  payment_transaction: { id: 88002 },
}))
const payOther = await purchase(ui, paymentSucceeded({
  event: 'payment.succeeded',
  offer: { id: 11111, title: 'Other offer', type: 'one-time' },
  member: { email: 'pay.other@example.com', name: 'Pay Other' },
  payment_transaction: { id: 88003 },
}))
assert(payWomen.status === 201 && payWomen.body.granted === true, 'payment.succeeded grants the women’s offer 2147989270')
assert(payMen.status === 201 && payMen.body.granted === true, 'payment.succeeded grants the men’s offer 2149556914')
assert(
  payOther.status === 200 && payOther.body.ignored === true && payOther.body.reason === 'offer',
  'payment.succeeded ignores an offer outside the allowlist',
)

function orderCreated(offerId, email, { event = 'order.created', orderId, paymentId }) {
  return {
    event,
    order: {
      id: orderId,
      source: 'cart',
      order_items: [{ type: 'Offer', id: offerId, title: 'Course', quantity: 1, total_amount: 14900 }],
    },
    member: { id: 42, email, name: 'Cart Buyer', first_name: 'Cart', last_name: 'Buyer' },
    payment_transaction: { id: paymentId, created_at: '2026-10-25T12:00:00Z', amount_paid: 14900 },
  }
}
const orderWomen = await purchase(ui, orderCreated(2147989270, 'order.women@example.com', { orderId: 77001, paymentId: 88011 }))
const orderMen = await purchase(ui, orderCreated(2149556914, 'order.men@example.com', { orderId: 77002, paymentId: 88012 }))
const orderOther = await purchase(ui, orderCreated(11111, 'order.other@example.com', { orderId: 77003, paymentId: 88013 }))
assert(orderWomen.status === 201 && orderWomen.body.granted === true, 'order.created grants the women’s offer 2147989270')
assert(orderMen.status === 201 && orderMen.body.granted === true, 'order.created grants the men’s offer 2149556914')
assert(
  orderOther.status === 200 && orderOther.body.ignored === true && orderOther.body.reason === 'offer',
  'order.created ignores an offer outside the allowlist',
)
const nestedName = await purchase(
  ui,
  orderCreated(2147989270, 'nested.name@example.com', {
    event: { name: 'order.created' },
    orderId: 77021,
    paymentId: 88021,
  }),
)
assert(nestedName.status === 201 && nestedName.body.granted === true, 'a nested event name order.created still grants')
const nestedDeeper = await purchase(
  ui,
  orderCreated(2149556914, 'nested.deeper@example.com', {
    event: { name: { name: 'order.created' } },
    orderId: 77022,
    paymentId: 88022,
  }),
)
assert(nestedDeeper.status === 201, 'a nested event object is read without throwing')
const typed = paymentSucceeded({
  offer: { id: 2147989270, title: 'PfilAtes for Women', type: 'one-time' },
  member: { email: 'typed.event@example.com', name: 'Typed' },
  payment_transaction: { id: 88023 },
})
typed.type = 'payment.succeeded'
const typedGrant = await purchase(ui, typed)
assert(typedGrant.status === 201, 'body.type payment.succeeded grants when event is absent')
const opaque = await purchase(
  ui,
  orderCreated(2147989270, 'opaque.event@example.com', {
    event: { label: 'not-a-name' },
    orderId: 77024,
    paymentId: 88024,
  }),
)
assert(opaque.status === 201 && opaque.body.reason !== 'event', 'an unreadable event object is not stringified into [object Object]')
const namedForm = await purchase(
  ui,
  orderCreated(2147989270, 'named.form@example.com', {
    event: { name: 'form.submission' },
    orderId: 77025,
    paymentId: 88025,
  }),
)
assert(namedForm.status === 200 && namedForm.body.reason === 'event', 'a nested form.submission name does not grant')

const reversed = memoryEntitlementStore()
const cartFirst = await purchase(reversed, cartPurchase({ event: 'Cart Purchase', member: { email: 'cart.first@example.com' } }))
const paySecond = await purchase(reversed, paymentSucceeded({ member: { email: 'cart.first@example.com' }, event: 'payment.succeeded' }), {
  now: '2026-11-01T00:00:00.000Z',
})
const reversedRow = await reversed.getEmail('cart.first@example.com')
assert(
  cartFirst.status === 201 &&
    paySecond.body.idempotent === true &&
    reversed.emails.size === 1 &&
    reversedRow?.orderId === '9001' &&
    reversedRow?.ts === NOW,
  'Cart Purchase then Payment Succeeded keeps the first entitlement',
)

const secondOrder = await purchase(
  store,
  paymentSucceeded({ payment_transaction: { id: 88888 }, event: 'payment.succeeded' }),
  { now: '2026-12-01T00:00:00.000Z' },
)
assert(
  secondOrder.body.idempotent === true &&
    (await store.getEmail('jane.smith@example.com'))?.orderId === '55555' &&
    store.emails.size === 1,
  'a later payment for the same email does not create a second entitlement',
)

const plusStore = memoryEntitlementStore()
await purchase(plusStore, paymentSucceeded({ member: { email: 'jane+doe@example.com' }, payment_transaction: { id: 4242 } }))
const redeemForOpen = memoryRedeemStore()
const waitingA = await handleKajabiOpen({
  entitlementStore: plusStore,
  redeemStore: redeemForOpen,
  counterStore: memoryCounterStore(),
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'nobody@example.com' }),
  ip: '203.0.113.10',
  now: NOW,
  nowMs: NOW_MS,
  limit: 5,
})
const waitingB = await handleKajabiOpen({
  entitlementStore: plusStore,
  redeemStore: redeemForOpen,
  counterStore: memoryCounterStore(),
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'also-not-yet@example.com' }),
  ip: '203.0.113.11',
  now: NOW,
  nowMs: NOW_MS,
  limit: 5,
})
assert(
  waitingA.status === 200 &&
    JSON.stringify(waitingA.body) === JSON.stringify(waitingB.body) &&
    waitingA.body.ready === false &&
    waitingA.body.token === undefined &&
    waitingA.body.email === undefined,
  'open without an entitlement looks the same for every address',
)

const openCounters = memoryCounterStore()
const opened = await handleKajabiOpen({
  entitlementStore: plusStore,
  redeemStore: redeemForOpen,
  counterStore: openCounters,
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'jane doe@example.com' }),
  ip: '203.0.113.12',
  now: NOW,
  nowMs: NOW_MS,
  limit: 5,
  randomBytes: () => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
})
const openedAgain = await handleKajabiOpen({
  entitlementStore: plusStore,
  redeemStore: redeemForOpen,
  counterStore: openCounters,
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'jane+doe@example.com' }),
  ip: '203.0.113.13',
  now: '2026-10-25T19:00:00.000Z',
  nowMs: NOW_MS,
  limit: 5,
  randomBytes: () => Uint8Array.from({ length: 16 }, () => 9),
})
const redeemed = await handleRedeem({
  store: redeemForOpen,
  body: { token: opened.body.token, email: opened.body.email },
  now: NOW,
})
assert(
  opened.status === 200 &&
    opened.body.ready === true &&
    opened.body.email === 'jane+doe@example.com' &&
    opened.body.token === 'SARA-ABCD-EFGH-JKLM-NPQR' &&
    openedAgain.body.token === opened.body.token &&
    openedAgain.body.ready === true &&
    redeemed.status === 200 &&
    redeemed.body.ok === true,
  'open with an entitlement mints once and redeems like /r/:token',
)
assert(
  [...openCounters.rows.keys()].every((key) => key.startsWith('rl:kajabi:open:') && !key.includes('203.0.113')),
  'open rate-limit keys are hashed and use the kajabi prefix',
)

const limited = memoryCounterStore()
const limitIp = '203.0.113.50'
let lastWaiting = null
for (let i = 0; i < 2; i++) {
  lastWaiting = await handleKajabiOpen({
    entitlementStore: plusStore,
    redeemStore: redeemForOpen,
    counterStore: limited,
    secret: SECRET,
    rawBody: JSON.stringify({ email: `stranger${i}@example.com` }),
    ip: limitIp,
    now: NOW,
    nowMs: NOW_MS,
    limit: 2,
  })
}
const limitedBuyer = await handleKajabiOpen({
  entitlementStore: plusStore,
  redeemStore: redeemForOpen,
  counterStore: limited,
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'jane+doe@example.com' }),
  ip: limitIp,
  now: NOW,
  nowMs: NOW_MS,
  limit: 2,
})
const limitedStranger = await handleKajabiOpen({
  entitlementStore: plusStore,
  redeemStore: redeemForOpen,
  counterStore: limited,
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'someone-else@example.com' }),
  ip: limitIp,
  now: NOW,
  nowMs: NOW_MS,
  limit: 2,
})
const otherIp = await handleKajabiOpen({
  entitlementStore: memoryEntitlementStore(),
  redeemStore: redeemForOpen,
  counterStore: limited,
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'jane+doe@example.com' }),
  ip: '203.0.113.51',
  now: NOW,
  nowMs: NOW_MS,
  limit: 2,
})
assert(lastWaiting?.status === 200 && lastWaiting.body.ready === false, 'lookups under the cap still answer')
assert(
  limitedBuyer.status === 429 &&
    limitedBuyer.body.error === 'rate_limited' &&
    limitedBuyer.retryAfter >= 1 &&
    limitedBuyer.body.token === undefined &&
    JSON.stringify(limitedBuyer.body) === JSON.stringify(limitedStranger.body),
  'open lookups are rate-limited per IP with the same body either way',
)
assert(otherIp.status === 200 && otherIp.body.ready === false, 'a different IP is not blocked by that cap')

const grantStore = memoryEntitlementStore()
const grantDenied = await handleKajabiGrant({
  store: grantStore,
  secret: SECRET,
  getHeader: headers({ authorization: 'Bearer nope' }),
  rawBody: JSON.stringify({ email: 'early@example.com', offerId: '2147989270' }),
  now: NOW,
})
assert(grantDenied.status === 401 && grantStore.emails.size === 0, 'grant without the mint secret is rejected')
const grantedAdmin = await handleKajabiGrant({
  store: grantStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  rawBody: JSON.stringify({ email: ' Early@Example.com ', offerId: '2147989270', orderId: 'backfill-1' }),
  now: NOW,
})
const grantedAgain = await handleKajabiGrant({
  store: grantStore,
  secret: SECRET,
  getHeader: headers({ 'x-redeem-mint-secret': SECRET }),
  rawBody: JSON.stringify({ email: 'early@example.com', offerId: '2149556914' }),
  now: '2026-10-26T00:00:00.000Z',
})
assert(
  grantedAdmin.status === 201 &&
    grantedAdmin.body.email === 'early@example.com' &&
    grantedAdmin.body.offerId === '2147989270' &&
    grantedAdmin.body.orderId === 'backfill-1' &&
    grantedAgain.status === 200 &&
    grantedAgain.body.idempotent === true &&
    grantedAgain.body.offerId === '2147989270' &&
    grantedAgain.body.ts === NOW &&
    !JSON.stringify(grantedAdmin.body).includes(SECRET),
  'admin grant records an entitlement and a repeat does not replace it',
)
const openedGrant = await handleKajabiOpen({
  entitlementStore: grantStore,
  redeemStore: memoryRedeemStore(),
  counterStore: memoryCounterStore(),
  secret: SECRET,
  rawBody: JSON.stringify({ email: 'early@example.com' }),
  ip: '198.51.100.8',
  now: NOW,
  nowMs: NOW_MS,
})
assert(openedGrant.body.ready === true && typeof openedGrant.body.token === 'string', 'a backfilled email can open Sara')

const kv = new Map()
const kvStore = kvEntitlementStore({
  async get(key, type) {
    const value = kv.get(key)
    if (value == null) return null
    return type === 'json' ? JSON.parse(value) : value
  },
  async put(key, value) {
    kv.set(key, value)
  },
})
const viaKv = await purchase(kvStore, paymentSucceeded({ member: { email: 'kv@example.com' }, payment_transaction: { id: 42 } }))
const viaKvAgain = await purchase(kvStore, cartPurchase({ member: { email: 'kv@example.com' }, payment_transaction: { id: 42 } }))
assert(
  viaKv.status === 201 &&
    viaKvAgain.body.idempotent === true &&
    kv.has('kajabi:email:kv@example.com') &&
    kv.get('kajabi:order:42') === 'kv@example.com',
  'KV entitlement is keyed by email and order id',
)

const dir = await mkdtemp(join(tmpdir(), 'sara-kajabi-'))
try {
  const file = join(dir, 'entitlements.json')
  const first = createFileEntitlementStore(file)
  const savedGrant = await handleKajabiGrant({
    store: first,
    secret: SECRET,
    getHeader: headers({ authorization: `Bearer ${SECRET}` }),
    rawBody: JSON.stringify({ email: 'file@example.com', offerId: '2147989270' }),
    now: NOW,
  })
  const second = createFileEntitlementStore(file)
  const loaded = await second.getEmail('file@example.com')
  assert(
    savedGrant.status === 201 && loaded?.offerId === '2147989270' && loaded?.email === 'file@example.com',
    'file entitlement store survives a process restart',
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}

const workerKv = new Map()
const workerEnv = {
  REDEEM_MINT_SECRET: SECRET,
  KAJABI_WEBHOOK_KEY: KEY,
  KAJABI_SARA_OFFER_IDS: OFFERS,
  XAI_TTS_VOICE: 'ara',
  SARA_PUBLIC_ORIGIN: 'https://sara-pfilates.surge.sh',
  REDEEM_TOKENS: {
    async get(key, type) {
      const value = workerKv.get(key)
      if (value == null) return null
      return type === 'json' ? JSON.parse(value) : value
    },
    async put(key, value) {
      workerKv.set(key, value)
    },
  },
}

async function workerPost(pathname, { json, key, ip, bearer, origin } = {}) {
  const url = new URL(pathname, 'https://worker.test')
  if (key) url.searchParams.set('key', key)
  return askWorker.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        origin: origin || 'https://sara-pfilates.surge.sh',
        'content-type': 'application/json',
        ...(ip ? { 'cf-connecting-ip': ip } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(json ?? {}),
    }),
    workerEnv,
  )
}

const health = await askWorker.fetch(new Request('https://worker.test/health'), workerEnv)
const healthBody = await health.json()
assert(
  Object.keys(healthBody).sort().join(',') === 'model,ok,redeem,stream,talk,tts' && healthBody.ok === true && healthBody.redeem === true,
  'Worker /health is unchanged',
)
const workerDenied = await workerPost('/kajabi/purchase', { key: 'nope', json: paymentSucceeded() })
assert(workerDenied.status === 401 && workerKv.size === 0, 'Worker purchase rejects a bad key and writes nothing')
const workerGrant = await workerPost('/kajabi/purchase', { key: KEY, json: paymentSucceeded() })
const workerGrantBody = await workerGrant.json()
const workerCart = await workerPost('/kajabi/purchase', { key: KEY, json: cartPurchase() })
const workerCartBody = await workerCart.json()
assert(
  workerGrant.status === 201 &&
    workerGrantBody.granted === true &&
    workerGrantBody.idempotent === false &&
    workerCart.status === 200 &&
    workerCartBody.idempotent === true &&
    workerKv.has('kajabi:email:jane.smith@example.com'),
  'Worker accepts Payment Succeeded and treats the matching Cart Purchase as a repeat',
)
const workerIgnored = await workerPost('/kajabi/purchase', {
  key: KEY,
  json: paymentSucceeded({ offer: { id: 42 }, member: { email: 'other-offer@example.com' }, payment_transaction: { id: 99 } }),
})
const workerIgnoredBody = await workerIgnored.json()
assert(workerIgnored.status === 200 && workerIgnoredBody.reason === 'offer' && !workerKv.has('kajabi:email:other-offer@example.com'), 'Worker filters offer ids')
const workerMiss = await workerPost('/kajabi/open', { json: { email: 'not-a-buyer@example.com' }, ip: '198.51.100.20' })
const workerMissBody = await workerMiss.json()
const workerMissToo = await workerPost('/kajabi/open', { json: { email: 'still-waiting@example.com' }, ip: '198.51.100.21' })
const workerMissTooBody = await workerMissToo.json()
assert(
  workerMiss.status === 200 &&
    workerMissBody.ready === false &&
    JSON.stringify(workerMissBody) === JSON.stringify(workerMissTooBody) &&
    workerMiss.headers.get('access-control-allow-origin') === 'https://sara-pfilates.surge.sh',
  'Worker open without an entitlement stays quiet and allows the phone origin',
)
const workerOpen = await workerPost('/kajabi/open', { json: { email: 'Jane.Smith@Example.com' }, ip: '198.51.100.22' })
const workerOpenBody = await workerOpen.json()
const workerOpenAgain = await workerPost('/kajabi/open', { json: { email: 'jane.smith@example.com' }, ip: '198.51.100.23' })
const workerOpenAgainBody = await workerOpenAgain.json()
const workerRedeem = await askWorker.fetch(
  new Request('https://worker.test/redeem', {
    method: 'POST',
    headers: { origin: 'https://sara-pfilates.surge.sh', 'content-type': 'application/json' },
    body: JSON.stringify({ token: workerOpenBody.token, email: workerOpenBody.email }),
  }),
  workerEnv,
)
const workerRedeemBody = await workerRedeem.json()
assert(
  workerOpen.status === 200 &&
    workerOpenBody.ready === true &&
    workerOpenAgainBody.token === workerOpenBody.token &&
    workerRedeem.status === 200 &&
    workerRedeemBody.ok === true &&
    workerRedeemBody.email === 'jane.smith@example.com',
  'Worker open reuses one redeem token and /redeem accepts it',
)
const limitHeadersIp = '198.51.100.77'
for (let i = 0; i < 8; i++) {
  await workerPost('/kajabi/open', { json: { email: `limit${i}@example.com` }, ip: limitHeadersIp })
}
const workerLimited = await workerPost('/kajabi/open', { json: { email: 'jane.smith@example.com' }, ip: limitHeadersIp })
const workerLimitedStranger = await workerPost('/kajabi/open', { json: { email: 'limit-extra@example.com' }, ip: limitHeadersIp })
assert(
  workerLimited.status === 429 &&
    workerLimited.headers.get('retry-after') &&
    JSON.stringify(await workerLimited.json()) === JSON.stringify(await workerLimitedStranger.json()),
  'Worker open rate-limits an IP and does not answer differently for a buyer',
)
const workerBackfill = await workerPost('/kajabi/grant', {
  bearer: SECRET,
  json: { email: 'comp@example.com', offerId: '2147989270' },
})
const workerBackfillBody = await workerBackfill.json()
const workerBackfillOpen = await workerPost('/kajabi/open', { json: { email: 'comp@example.com' }, ip: '198.51.100.30' })
const workerBackfillOpenBody = await workerBackfillOpen.json()
assert(
  workerBackfill.status === 201 &&
    workerBackfillBody.idempotent === false &&
    workerBackfillOpenBody.ready === true,
  'Worker grant uses the mint secret and that email can open Sara',
)
const demo = await askWorker.fetch(
  new Request('https://worker.test/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'DEMO-SARA-001', email: 'qa@example.com' }),
  }),
  workerEnv,
)
const demoBody = await demo.json()
const classMint = await askWorker.fetch(
  new Request('https://worker.test/redeem/mint', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ multiUse: true, externalId: 'class-cert-sac-2026-10-08' }),
  }),
  workerEnv,
)
const classMintBody = await classMint.json()
assert(demo.status === 200 && demoBody.demo === true, 'DEMO-SARA-001 still redeems')
assert(classMint.status === 201 && classMintBody.multiUse === true && String(classMintBody.url).includes('/r/'), 'class mint still returns a /r/ link')

const workerSrc = readFileSync(join(root, 'worker/src/index.js'), 'utf8')
const nodeSrc = readFileSync(join(root, 'server/index.mjs'), 'utf8')
const kajabiSrc = readFileSync(join(root, 'server/kajabiPurchase.mjs'), 'utf8')
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8')
const pageSrc = readFileSync(join(root, 'src/pages/OpenSara.tsx'), 'utf8')
const wrangler = readFileSync(join(root, 'worker/wrangler.toml'), 'utf8')
const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
assert(workerSrc.includes('dispatchKajabi') && nodeSrc.includes('dispatchKajabi'), 'Worker and Node both dispatch Kajabi routes')
assert(workerSrc.includes("pathname === '/health'") && !workerSrc.includes('kajabi:') && !kajabiSrc.includes('rl:demo:'), 'health and demo counter keys stay put')
assert(/KAJABI_WEBHOOK_KEY/.test(wrangler) && !/^KAJABI_WEBHOOK_KEY\s*=/m.test(wrangler), 'webhook key is documented, not assigned')
assert(/KAJABI_SARA_OFFER_IDS/.test(wrangler) && !/^KAJABI_SARA_OFFER_IDS\s*=/m.test(wrangler), 'offer allowlist is documented, not assigned')
assert(vite.includes("'/kajabi'"), 'Vite proxies /kajabi to the local API')
assert(appSrc.includes('path="/open"') && pageSrc.includes('SARA_OPEN_WAITING') && pageSrc.includes('redeemToken'), 'the phone opens /open and redeems')
assert(!pageSrc.includes('KAJABI_WEBHOOK_KEY') && !kajabiSrc.includes('createHmac') && !/sendMail|nodemailer|smtp/i.test(kajabiSrc), 'the page has no webhook secret and the Worker sends no mail')

const script = spawn(process.execPath, [join(root, 'worker/scripts/grant-entitlement.mjs'), '--self-test'])
let scriptOut = ''
script.stdout.on('data', (chunk) => {
  scriptOut += chunk
})
script.stderr.on('data', (chunk) => {
  scriptOut += chunk
})
const scriptCode = await new Promise((resolve) => script.on('close', resolve))
assert(scriptCode === 0 && /does not print the secret/.test(scriptOut), 'grant script posts the buyer and hides the secret')

if (process.exitCode) {
  console.error('kajabi purchase smoke failed')
  process.exit(1)
}
console.log('kajabi purchase smoke passed')
