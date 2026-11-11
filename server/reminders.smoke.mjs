import { readFileSync } from 'node:fs'
import { DEMO_TOKEN } from './redeem.mjs'
import {
  DUE_WINDOW_MINUTES,
  REMINDER_BODY,
  REMINDER_TITLE,
  dispatchDueReminders,
  dispatchReminderRequest,
  memoryReminderStore,
  parseReminderTime,
  reminderIsDue,
  reminderPayload,
  suppressedEmailSet,
  validTimeZone,
} from './reminders.mjs'
import { bytesToBase64Url, decryptWebPushRecord, encryptWebPush, vapidAuthorization } from './webPush.mjs'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

const PASS = 'SARA-ABCD-EFGH-JKLM-NPQR'
const EMAIL = 'buyer@example.com'
const OTHER = 'other@example.com'
const CLASS_EMAIL = 'student@example.com'
const SUPPRESSED = 'quiet@example.com'

function redeemStore(records) {
  return {
    async get(token) {
      return records[token] ?? null
    },
  }
}

const purchased = redeemStore({
  [PASS]: { token: PASS, email: EMAIL, multiUse: false },
  'SARA-CLASS-PASS-XXXX-YYYY': { token: 'SARA-CLASS-PASS-XXXX-YYYY', email: null, multiUse: true },
})

function query(params) {
  return new URLSearchParams(params)
}

const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const vapidPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', vapidKeys.publicKey))
const vapidPrivateJwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey)
const vapid = {
  publicKey: bytesToBase64Url(vapidPublicRaw),
  privateKey: vapidPrivateJwk.d,
  subject: 'mailto:ops@example.com',
}

const sub = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const subPublic = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', sub.publicKey)))
const subAuth = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
const subscription = {
  endpoint: 'https://push.example/subscription/1',
  keys: { p256dh: subPublic, auth: subAuth },
}

assert(REMINDER_BODY === 'Time for your 10-minute PfilAtes™ routine', 'reminder text is the neutral 10-minute line')
assert(REMINDER_TITLE === 'Sara', 'reminder title is Sara')
assert(!/74%|10x a Kegel|ten times more than a Kegel/i.test(REMINDER_BODY), 'reminder text has no withdrawn claim')
assert(reminderPayload() === JSON.stringify({ title: REMINDER_TITLE, body: REMINDER_BODY }), 'payload is only the title and that sentence')
assert(!reminderPayload().includes('@'), 'payload does not carry an email')
assert(parseReminderTime('07:30') === '07:30', 'a clock time is accepted')
assert(parseReminderTime('25:99') === null && parseReminderTime('7:30') === null, 'a bad clock time is rejected')
assert(validTimeZone('America/Los_Angeles') === 'America/Los_Angeles', 'an IANA zone is accepted')
assert(validTimeZone('Not/AZone') === null, 'an unknown zone is rejected')
assert(DUE_WINDOW_MINUTES === 15, 'a late cron still has a 15-minute window')

const noon = new Date('2026-11-10T16:05:00Z')
assert(
  reminderIsDue({ time: '16:00', timeZone: 'UTC', endpoint: subscription.endpoint, lastSentLocalDate: null }, noon),
  'a reminder is due inside the window',
)
assert(
  !reminderIsDue({ time: '16:20', timeZone: 'UTC', endpoint: subscription.endpoint, lastSentLocalDate: null }, noon),
  'a later time is not due yet',
)
assert(
  !reminderIsDue({ time: '15:50', timeZone: 'UTC', endpoint: subscription.endpoint, lastSentLocalDate: null }, noon),
  'a window that already closed is not due',
)
assert(
  !reminderIsDue(
    { time: '16:00', timeZone: 'UTC', endpoint: subscription.endpoint, lastSentLocalDate: '2026-11-10' },
    noon,
  ),
  'a reminder already sent today is not due again',
)

const suppress = suppressedEmailSet(' Quiet@example.com, not-an-email ', '["buyer@example.com"]')
assert(suppress.has(SUPPRESSED) && suppress.has(EMAIL), 'env and KV suppression lists combine')
assert(!suppress.has('not-an-email'), 'a non-email is not a suppression entry')

const store = memoryReminderStore()
const base = {
  store,
  redeemStore: purchased,
  vapid,
  envSuppress: SUPPRESSED,
  now: noon,
}

const demo = await dispatchReminderRequest('/reminders', 'POST', {
  ...base,
  body: { pass: DEMO_TOKEN, email: EMAIL, enabled: true, time: '08:00', timeZone: 'UTC', subscription },
})
assert(demo.status === 403 && demo.body.error === 'not_entitled', 'the demo pass cannot sign up')

const mismatch = await dispatchReminderRequest('/reminders', 'POST', {
  ...base,
  body: { pass: PASS, email: OTHER, enabled: true, time: '08:00', timeZone: 'UTC', subscription },
})
assert(mismatch.status === 409 && mismatch.body.error === 'email_mismatch', 'a purchased pass rejects a different email')

const unknown = await dispatchReminderRequest('/reminders', 'GET', {
  ...base,
  body: {},
  query: query({ pass: 'SARA-NOPE-NOPE-NOPE-NOPE', email: EMAIL }),
})
assert(unknown.status === 403, 'an unknown pass is not entitled')

const off = await dispatchReminderRequest('/reminders', 'GET', {
  ...base,
  body: {},
  query: query({ pass: PASS, email: EMAIL }),
})
assert(off.status === 200 && off.body.enabled === false, 'a new email defaults to off')

const saved = await dispatchReminderRequest('/reminders', 'POST', {
  ...base,
  body: { pass: PASS, email: EMAIL, enabled: true, time: '16:00', timeZone: 'UTC', subscription },
})
assert(saved.status === 200 && saved.body.enabled === true, 'an entitled email can opt in')
assert((await store.get(EMAIL))?.endpoint === subscription.endpoint, 'the subscription is stored under that email')

const suppressedStore = memoryReminderStore({
  records: [
    {
      email: EMAIL,
      time: '16:00',
      timeZone: 'UTC',
      endpoint: subscription.endpoint,
      p256dh: subPublic,
      auth: subAuth,
      lastSentLocalDate: null,
    },
  ],
})
const suppressedPost = await dispatchReminderRequest('/reminders', 'POST', {
  ...base,
  store: suppressedStore,
  envSuppress: EMAIL,
  body: { pass: PASS, email: EMAIL, enabled: true, time: '16:00', timeZone: 'UTC', subscription },
})
assert(suppressedPost.status === 403 && suppressedPost.body.error === 'suppressed', 'a suppressed email cannot opt in')
assert((await suppressedStore.get(EMAIL)) == null, 'a suppressed email is removed and not stored')

const classPass = 'SARA-CLASS-PASS-XXXX-YYYY'
const classSaved = await dispatchReminderRequest('/reminders', 'POST', {
  ...base,
  body: {
    pass: classPass,
    email: CLASS_EMAIL,
    enabled: true,
    time: '16:00',
    timeZone: 'UTC',
    subscription: { ...subscription, endpoint: 'https://push.example/subscription/class' },
  },
})
assert(classSaved.status === 200, 'a class pass can opt in with the email on the phone')

let fetches = []
const results = await dispatchDueReminders({
  store,
  envSuppress: `${SUPPRESSED}, ${CLASS_EMAIL}`,
  vapid,
  now: noon,
  fetchFn: async (url, init) => {
    fetches.push({ url, init })
    return { status: 201 }
  },
})
assert(fetches.length === 1, 'one due reminder is sent')
assert(fetches[0].url === subscription.endpoint, 'the send goes to the stored endpoint')
assert(results.some((row) => row.email === CLASS_EMAIL && row.status === 'suppressed'), 'a KV-or-env suppressed email is not sent')
assert(!fetches.some((call) => String(call.url).includes('class')), 'the suppressed class email makes no request')
const sentBody = new Uint8Array(fetches[0].init.body)
assert(sentBody[20] === 65, 'the push record carries the server public key')
const decrypted = await decryptWebPushRecord({
  body: sentBody,
  userPrivateKey: sub.privateKey,
  userPublicKey: subPublic,
  userAuth: subAuth,
})
assert(decrypted === reminderPayload(), 'the phone can read the neutral reminder')
assert(/vapid t=/.test(fetches[0].init.headers.Authorization), 'the request is VAPID-signed')
assert((await store.get(EMAIL))?.lastSentLocalDate === '2026-11-10', 'the local date is recorded after a send')

await store.delete(CLASS_EMAIL)
fetches = []
await dispatchDueReminders({
  store,
  envSuppress: '',
  vapid,
  now: noon,
  fetchFn: async () => {
    fetches.push('again')
    return { status: 201 }
  },
})
assert(fetches.length === 0, 'the same local day does not send twice')

const goneStore = memoryReminderStore({
  records: [
    {
      email: EMAIL,
      time: '16:00',
      timeZone: 'UTC',
      endpoint: subscription.endpoint,
      p256dh: subPublic,
      auth: subAuth,
      lastSentLocalDate: null,
    },
  ],
})
const gone = await dispatchDueReminders({
  store: goneStore,
  envSuppress: '',
  vapid,
  now: noon,
  fetchFn: async () => ({ status: 410 }),
})
assert(gone[0]?.status === 'gone' && (await goneStore.get(EMAIL)) == null, 'a gone subscription is deleted')

const turnedOff = await dispatchReminderRequest('/reminders', 'POST', {
  ...base,
  store,
  body: { pass: PASS, email: EMAIL, enabled: false },
})
assert(turnedOff.status === 200 && turnedOff.body.enabled === false, 'turning it off deletes the sign-up')
assert((await store.get(EMAIL)) == null, 'an off reminder is not stored')

const signed = await vapidAuthorization({
  endpoint: subscription.endpoint,
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  subject: vapid.subject,
  nowSec: 1_700_000_000,
})
const [header, claims, sig] = signed.jwt.split('.')
const headerJson = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
const claimsJson = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))
assert(headerJson.alg === 'ES256', 'VAPID JWT is ES256')
assert(claimsJson.aud === 'https://push.example' && claimsJson.sub === vapid.subject, 'VAPID audience is the push origin')
const verified = await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' },
  vapidKeys.publicKey,
  Buffer.from(sig, 'base64url'),
  new TextEncoder().encode(`${header}.${claims}`),
)
assert(verified, 'VAPID signature verifies')

const round = await encryptWebPush({
  userPublicKey: subPublic,
  userAuth: subAuth,
  payload: reminderPayload(),
})
assert(round[16] === 0 && round[17] === 0 && round[18] === 16 && round[19] === 0, 'record size is 4096')

const page = readFileSync(new URL('../src/components/DailyReminder.tsx', import.meta.url), 'utf8')
const handler = readFileSync(new URL('../public/push-handler.js', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8')
const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8')
assert(page.includes('REMINDER_BODY') && page.includes('Turn reminder on'), 'the phone shows the opt-in and the reminder sentence')
assert(/default OFF|off until you turn it on/i.test(page), 'the control says it starts off')
assert(handler.includes(REMINDER_BODY), 'the service worker shows the same sentence')
assert(!/74%|10x a Kegel/i.test(page + handler + REMINDER_BODY), 'reminder UI has no withdrawn claim')
assert(worker.includes('dispatchDueReminders') && worker.includes('scheduled'), 'the worker cron dispatches reminders')
assert(toml.includes('crons') && toml.includes('* * * * *'), 'the worker cron is every minute')
assert(!/VAPID_PRIVATE_KEY\s*=\s*['"][A-Za-z0-9_-]{20,}/.test(toml), 'wrangler.toml does not contain a VAPID private key')

if (process.exitCode) {
  console.error('reminder smoke failed')
  process.exit(1)
}
console.log('reminder smoke passed')
