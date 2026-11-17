import { readFileSync } from 'node:fs'
import { DEMO_TOKEN } from './redeem.mjs'
import {
  DUE_WINDOW_MINUTES,
  REMINDER_BODY,
  REMINDER_INDEX_KEY,
  REMINDER_PREFIX,
  REMINDER_TITLE,
  dispatchDueReminders,
  dispatchReminderRequest,
  kvReminderStore,
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

const atUtc = (hhmm) => new Date(`2026-11-10T${hhmm}:00Z`)
function dueAt(time, hhmm, lastSentLocalDate = null) {
  return reminderIsDue(
    { time, timeZone: 'UTC', endpoint: subscription.endpoint, lastSentLocalDate },
    atUtc(hhmm),
  )
}
assert(dueAt('08:07', '08:07'), '8:07 is due at 8:07')
assert(dueAt('08:07', '08:15'), '8:07 is due at the 8:15 run')
assert(dueAt('08:01', '08:15'), 'a minute after a quarter-hour is still due 14 minutes later')
assert(!dueAt('08:07', '08:00'), '8:07 is not due before its local time')
assert(!dueAt('08:07', '08:22'), '8:07 is not due once the 15-minute window has closed')
assert(!dueAt('08:00', '08:15'), 'a reminder 15 minutes ago is outside the window')
assert(!dueAt('08:07', '08:15', '2026-11-10'), '8:07 does not fire twice on the same local day')
assert(dueAt('08:07', '08:15', '2026-11-09'), '8:07 fires again on the next local day')

const quarterStore = memoryReminderStore({
  records: [
    {
      email: EMAIL,
      time: '08:07',
      timeZone: 'UTC',
      endpoint: subscription.endpoint,
      p256dh: subPublic,
      auth: subAuth,
      lastSentLocalDate: null,
    },
  ],
})
let quarterFetches = 0
const quarterNow = atUtc('08:15')
const quarterSent = await dispatchDueReminders({
  store: quarterStore,
  envSuppress: '',
  vapid,
  now: quarterNow,
  fetchFn: async () => {
    quarterFetches += 1
    return { status: 201 }
  },
})
assert(
  quarterFetches === 1 && quarterSent.some((row) => row.email === EMAIL && row.status === 'sent'),
  '8:07 fires once on the 8:15 run',
)
quarterFetches = 0
const quarterAgain = await dispatchDueReminders({
  store: quarterStore,
  envSuppress: '',
  vapid,
  now: quarterNow,
  fetchFn: async () => {
    quarterFetches += 1
    return { status: 201 }
  },
})
assert(
  quarterFetches === 0 && quarterAgain.some((row) => row.email === EMAIL && row.status === 'not_due'),
  'the same local day does not fire the 8:07 reminder again',
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
assert(toml.includes('crons') && toml.includes('"*/15 * * * *"'), 'the worker cron is every 15 minutes')
assert(!/crons\s*=\s*\[\s*"\* \* \* \* \*"\s*\]/.test(toml), 'the worker cron is not every minute')

function mockKv(seed = {}) {
  const data = new Map(Object.entries(seed))
  const calls = { list: 0, indexPuts: 0 }
  return {
    calls,
    data,
    async get(key) {
      return data.has(key) ? data.get(key) : null
    },
    async put(key, value) {
      if (key === REMINDER_INDEX_KEY) calls.indexPuts += 1
      data.set(key, value)
    },
    async delete(key) {
      data.delete(key)
    },
    async list({ prefix } = {}) {
      calls.list += 1
      const keys = [...data.keys()]
        .filter((key) => !prefix || String(key).startsWith(prefix))
        .map((name) => ({ name }))
      return { keys, list_complete: false, cursor: 'more' }
    },
  }
}

function indexEmails(kv) {
  return JSON.parse(kv.data.get(REMINDER_INDEX_KEY))
}

assert(REMINDER_INDEX_KEY === 'reminder-index', 'reminders share one index key')
assert(!REMINDER_INDEX_KEY.startsWith(REMINDER_PREFIX), 'the index key is not itself a reminder record')

const indexed = mockKv({ [REMINDER_INDEX_KEY]: '[]' })
const indexedStore = kvReminderStore(indexed)
const firstRecord = {
  email: 'a@example.com',
  time: '08:07',
  timeZone: 'UTC',
  endpoint: 'https://push.example/a',
  p256dh: subPublic,
  auth: subAuth,
  lastSentLocalDate: null,
}
await indexedStore.put(firstRecord)
assert(indexEmails(indexed).join() === 'a@example.com', 'put adds the email to the index')
assert(indexed.calls.list === 0, 'put does not list when the index exists')
assert(indexed.calls.indexPuts === 1, 'put writes the index when the email is new')
await indexedStore.put({ ...firstRecord, time: '09:15' })
assert(indexed.calls.indexPuts === 1, 'put does not rewrite the index when the email is already there')
assert((await indexedStore.get('a@example.com'))?.time === '09:15', 'put still updates the stored reminder')
await indexedStore.put({
  ...firstRecord,
  email: 'b@example.com',
  endpoint: 'https://push.example/b',
})
assert(indexEmails(indexed).join() === 'a@example.com,b@example.com', 'put appends a new email')
await indexedStore.delete('a@example.com')
assert(indexEmails(indexed).join() === 'b@example.com', 'delete removes the email from the index')
assert((await indexedStore.get('a@example.com')) == null, 'delete removes the reminder record')
const putsAfterDelete = indexed.calls.indexPuts
await indexedStore.delete('a@example.com')
await indexedStore.delete('missing@example.com')
assert(indexed.calls.indexPuts === putsAfterDelete, 'delete does not rewrite the index when the email is already gone')
assert(indexed.calls.list === 0, 'delete does not list when the index exists')

const listed = await indexedStore.list()
assert(indexed.calls.list === 0, 'list does not call kv.list once the index exists')
assert(listed.length === 1 && listed[0].email === 'b@example.com', 'list reads each indexed reminder')

const dropKv = mockKv({
  [REMINDER_INDEX_KEY]: JSON.stringify(['stay@example.com', 'gone@example.com']),
  [REMINDER_PREFIX + 'stay@example.com']: JSON.stringify({
    email: 'stay@example.com',
    time: '08:07',
    timeZone: 'UTC',
    endpoint: 'https://push.example/stay',
  }),
})
const dropStore = kvReminderStore(dropKv)
const left = await dropStore.list()
assert(dropKv.calls.list === 0, 'a present index is never listed')
assert(left.length === 1 && left[0].email === 'stay@example.com', 'a missing record is not returned')
assert(indexEmails(dropKv).join() === 'stay@example.com', 'list drops index entries whose record is missing')
const dropPuts = dropKv.calls.indexPuts
await dropStore.list()
assert(dropKv.calls.list === 0 && dropKv.calls.indexPuts === dropPuts, 'a second list does not list or rewrite the index')

const migrateKv = mockKv({
  [REMINDER_PREFIX + 'kept@example.com']: JSON.stringify({
    email: 'kept@example.com',
    time: '08:01',
    timeZone: 'UTC',
    endpoint: 'https://push.example/kept',
  }),
  'ops:do-not-contact': '["quiet@example.com"]',
  'other-key': 'nope',
})
const migrateStore = kvReminderStore(migrateKv)
const migrated = await migrateStore.list()
assert(migrateKv.calls.list === 1, 'migration does exactly one list')
assert(migrated.length === 1 && migrated[0].email === 'kept@example.com', 'migration returns the stored reminder')
assert(indexEmails(migrateKv).join() === 'kept@example.com', 'migration writes the index and skips other keys')
await migrateStore.list()
await migrateStore.get('kept@example.com')
assert(migrateKv.calls.list === 1, 'list does not call kv.list after the index exists')

const seedKv = mockKv({
  [REMINDER_PREFIX + 'old@example.com']: JSON.stringify({
    email: 'old@example.com',
    time: '08:00',
    timeZone: 'UTC',
    endpoint: 'https://push.example/old',
  }),
})
const seedStore = kvReminderStore(seedKv)
await seedStore.put({
  email: 'new@example.com',
  time: '08:07',
  timeZone: 'UTC',
  endpoint: subscription.endpoint,
  p256dh: subPublic,
  auth: subAuth,
  lastSentLocalDate: null,
})
assert(seedKv.calls.list === 1, 'the first put migrates with exactly one list')
assert(seedKv.calls.indexPuts === 1, 'migration does not rewrite the index when the new email was listed')
const seeded = indexEmails(seedKv)
assert(
  seeded.includes('old@example.com') && seeded.includes('new@example.com'),
  'migration keeps existing emails and adds the new one',
)
await seedStore.delete('old@example.com')
assert(!indexEmails(seedKv).includes('old@example.com') && indexEmails(seedKv).includes('new@example.com'), 'delete after migration removes only that email')
assert(seedKv.calls.list === 1, 'delete does not list again after the index exists')

let kvFired = 0
const kvNow = atUtc('08:15')
const kvSent = await dispatchDueReminders({
  store: seedStore,
  envSuppress: '',
  vapid,
  now: kvNow,
  fetchFn: async () => {
    kvFired += 1
    return { status: 201 }
  },
})
assert(kvFired === 1 && kvSent.some((row) => row.email === 'new@example.com' && row.status === 'sent'), 'the indexed 8:07 reminder fires at 8:15')
assert(seedKv.calls.list === 1, 'dispatch does not list once the index exists')
const putsAfterSend = seedKv.calls.indexPuts
kvFired = 0
await dispatchDueReminders({
  store: seedStore,
  envSuppress: '',
  vapid,
  now: kvNow,
  fetchFn: async () => {
    kvFired += 1
    return { status: 201 }
  },
})
assert(kvFired === 0, 'the indexed reminder does not fire twice the same local day')
assert(seedKv.calls.indexPuts === putsAfterSend, 'recording a send does not rewrite the index')
assert(!/VAPID_PRIVATE_KEY\s*=\s*['"][A-Za-z0-9_-]{20,}/.test(toml), 'wrangler.toml does not contain a VAPID private key')

if (process.exitCode) {
  console.error('reminder smoke failed')
  process.exit(1)
}
console.log('reminder smoke passed')
