import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEMO_TOKEN,
  PUBLIC_ORIGIN_DEFAULT,
  authorizeMint,
  dispatchRedeem,
  formatToken,
  handleMint,
  handleRedeem,
  headerGetter,
  kvRedeemStore,
  memoryRedeemStore,
  publicRedeemOrigin,
} from './redeem.mjs'
import { createFileRedeemStore } from './redeemFileStore.mjs'
import askWorker from '../worker/src/index.js'

const root = fileURLToPath(new URL('..', import.meta.url))

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

const SECRET = 'test-mint-secret-0123456789abcdef'
const NOW = '2026-09-21T12:00:00.000Z'
const fixedBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])

assert(formatToken(fixedBytes) === 'SARA-ABCD-EFGH-JKLM-NPQR', 'token groups skip ambiguous characters')
assert(!/[IO01]/.test(formatToken(fixedBytes).slice(5)), 'alphabet has no I, O, 0, or 1')
assert(publicRedeemOrigin('') === PUBLIC_ORIGIN_DEFAULT, 'public origin defaults to the phone demo')
assert(publicRedeemOrigin('https://sara-pfilates.surge.sh/extra/') === 'https://sara-pfilates.surge.sh', 'link uses the origin only')
assert(publicRedeemOrigin('javascript:alert(1)') === PUBLIC_ORIGIN_DEFAULT, 'bad origin falls back to the phone demo')
assert(publicRedeemOrigin('http://localhost:43147/r') === 'http://localhost:43147', 'local http origin is allowed')

const open = await handleMint({
  store: memoryRedeemStore(),
  secret: '',
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: {},
})
assert(open.status === 503 && open.body.error === 'redeem_mint_unconfigured', 'mint without a secret is closed')

const denied = await handleMint({
  store: memoryRedeemStore(),
  secret: SECRET,
  getHeader: headers({ authorization: 'Bearer wrong-mint-secret-0123456789' }),
  body: { email: 'buyer@example.com', secret: SECRET },
})
assert(denied.status === 401 && !JSON.stringify(denied.body).includes(SECRET), 'body secret is ignored')

const noStore = await handleMint({
  store: null,
  secret: SECRET,
  getHeader: headers({ 'x-redeem-mint-secret': SECRET }),
  body: { email: 'buyer@example.com' },
})
assert(noStore.status === 503 && noStore.body.error === 'redeem_store_unconfigured', 'authed mint without KV reports the missing store')

const badEmail = await handleMint({
  store: memoryRedeemStore(),
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { email: 'not-an-email' },
  now: NOW,
})
assert(badEmail.status === 400 && badEmail.body.error === 'invalid_email', 'mint rejects a bad email')

const placeholder = await handleMint({
  store: memoryRedeemStore(),
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { externalId: '{{transaction_id}}' },
})
assert(placeholder.status === 400 && placeholder.body.error === 'invalid_external_id', 'unreplaced Zapier placeholders are rejected')

const store = memoryRedeemStore()
const minted = await handleMint({
  store,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { email: ' Buyer@Example.com ', externalId: 'Kajabi-TXN-9' },
  publicOrigin: 'https://sara-pfilates.surge.sh/',
  now: NOW,
  randomBytes: () => fixedBytes,
})
assert(minted.status === 201 && minted.body.token === 'SARA-ABCD-EFGH-JKLM-NPQR', 'mint returns a unique token')
assert(minted.body.email === 'buyer@example.com', 'mint email is normalized')
assert(minted.body.multiUse === false, 'purchase mint stays single-email')
assert(minted.body.usedAt === null && minted.body.createdAt === NOW, 'mint stores createdAt and an empty usedAt')
assert(minted.body.externalId === 'kajabi-txn-9', 'external id is normalized')
assert(minted.body.url === 'https://sara-pfilates.surge.sh/r/SARA-ABCD-EFGH-JKLM-NPQR', 'mint url is the public /r/:token link')
assert(minted.body.idempotent === false, 'first mint is not an idempotent replay')
assert(!JSON.stringify(minted.body).includes(SECRET), 'mint response does not echo the secret')

const replay = await handleMint({
  store,
  secret: SECRET,
  getHeader: headers({ 'x-redeem-mint-secret': SECRET }),
  body: { email: 'other@example.com', externalId: 'kajabi-txn-9' },
  now: '2026-09-22T00:00:00.000Z',
  randomBytes: () => Uint8Array.from({ length: 16 }, () => 3),
})
assert(replay.status === 200 && replay.body.idempotent === true, 'same purchase id returns the original pass')
assert(replay.body.token === minted.body.token && replay.body.email === 'buyer@example.com', 'replay keeps the first email and token')

const replayOpen = await handleMint({
  store,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { multiUse: true, externalId: 'kajabi-txn-9' },
  now: '2026-09-22T00:00:00.000Z',
  randomBytes: () => Uint8Array.from({ length: 16 }, () => 9),
})
assert(
  replayOpen.status === 200 &&
    replayOpen.body.idempotent === true &&
    replayOpen.body.multiUse === false &&
    replayOpen.body.token === minted.body.token &&
    replayOpen.body.email === 'buyer@example.com',
  'retrying a purchase id with multiUse does not open that pass',
)

const unknown = await handleRedeem({
  store,
  body: { token: 'SARA-ZZZZ-ZZZZ-ZZZZ-ZZZZ', email: 'buyer@example.com' },
  now: NOW,
})
assert(unknown.status === 404 && unknown.body.reason === 'unknown-token', 'unknown pass is rejected')

const mismatch = await handleRedeem({
  store,
  body: { token: minted.body.token, email: 'other@example.com' },
  now: NOW,
})
assert(mismatch.status === 409 && mismatch.body.reason === 'email-mismatch', 'a different email cannot use the pass')
const afterMismatch = await store.get(minted.body.token)
assert(afterMismatch.usedAt === null, 'rejected email does not mark the pass used')

const redeemed = await handleRedeem({
  store,
  body: { token: 'sara-abcd-efgh-jklm-npqr', email: 'buyer@example.com' },
  now: '2026-09-21T15:00:00.000Z',
})
assert(redeemed.status === 200 && redeemed.body.ok === true && redeemed.body.multiUse === false, 'matching email redeems')
assert(redeemed.body.usedAt === '2026-09-21T15:00:00.000Z', 'first redeem sets usedAt')

const again = await handleRedeem({
  store,
  body: { token: minted.body.token, email: 'buyer@example.com' },
  now: '2026-09-28T15:00:00.000Z',
})
assert(again.status === 200 && again.body.usedAt === redeemed.body.usedAt, 'same email can redeem again and usedAt stays')

const unbound = memoryRedeemStore()
const openMint = await handleMint({
  store: unbound,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: {},
  now: NOW,
  randomBytes: () => fixedBytes,
})
const locked = await handleRedeem({
  store: unbound,
  body: { token: openMint.body.token, email: 'first@example.com' },
  now: NOW,
})
const second = await handleRedeem({
  store: unbound,
  body: { token: openMint.body.token, email: 'second@example.com' },
  now: NOW,
})
assert(locked.status === 200 && second.status === 409, 'first email locks a pass that was minted without one')

const classBytes = Uint8Array.from([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35])
const classStore = memoryRedeemStore()
let classPuts = 0
const classPut = classStore.put.bind(classStore)
classStore.put = async (token, record) => {
  classPuts += 1
  return classPut(token, record)
}
const classMint = await handleMint({
  store: classStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { multiUse: true, externalId: 'class-cert-sac-2026-10-08' },
  now: NOW,
  randomBytes: () => classBytes,
})
const classToken = formatToken(classBytes)
assert(classMint.status === 201 && classMint.body.token === classToken, 'class mint returns a real SARA token')
assert(classMint.body.multiUse === true && classMint.body.email === null, 'class mint is multi-use and unbound')
assert(classMint.body.externalId === 'class-cert-sac-2026-10-08', 'class external id is stored')
assert(
  classMint.body.url === `${PUBLIC_ORIGIN_DEFAULT}/r/${classToken}`,
  'class redeem url stays on the phone demo origin',
)
assert(classPuts === 1, 'class mint writes the shared pass once')
const classReplay = await handleMint({
  store: classStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { externalId: 'Class-Cert-Sac-2026-10-08', email: 'late@example.com' },
  now: '2026-10-08T18:00:00.000Z',
  randomBytes: () => Uint8Array.from({ length: 16 }, () => 4),
})
assert(
  classReplay.status === 200 &&
    classReplay.body.idempotent === true &&
    classReplay.body.token === classToken &&
    classReplay.body.multiUse === true &&
    classReplay.body.email === null,
  'same class external id returns the original multi-use pass',
)
assert(classPuts === 1, 'idempotent class mint does not write again')
const classBefore = await classStore.get(classToken)
const studentA = await handleRedeem({
  store: classStore,
  body: { token: classToken, email: 'Student.A@example.com' },
  now: '2026-10-08T16:00:00.000Z',
})
const studentB = await handleRedeem({
  store: classStore,
  body: { token: ` ${classToken.toLowerCase()} `, email: 'student.b@example.com' },
  now: '2026-10-08T16:05:00.000Z',
})
const studentAAgain = await handleRedeem({
  store: classStore,
  body: { token: classToken, email: 'student.a@example.com' },
  now: '2026-10-08T17:00:00.000Z',
})
const classAfter = await classStore.get(classToken)
assert(
  studentA.status === 200 &&
    studentA.body.ok === true &&
    studentA.body.email === 'student.a@example.com' &&
    studentA.body.multiUse === true,
  'first class student redeems',
)
assert(studentB.status === 200 && studentB.body.email === 'student.b@example.com', 'second class student redeems the same token')
assert(
  studentAAgain.status === 200 && studentAAgain.body.usedAt === null,
  'same class email can redeem again without marking the shared pass used',
)
assert(
  classAfter.email === null &&
    classAfter.multiUse === true &&
    classAfter.usedAt === null &&
    JSON.stringify(classAfter) === JSON.stringify(classBefore),
  'class redeems do not bind an email onto the shared record',
)
assert(classPuts === 1, 'class redeem does not write the shared record')

const notMulti = await handleMint({
  store: memoryRedeemStore(),
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { multiUse: 'true', externalId: 'class-string-flag' },
  now: NOW,
  randomBytes: () => classBytes,
})
assert(notMulti.status === 400 && notMulti.body.error === 'invalid_multi_use', 'only a boolean multiUse flag opens a class pass')

const classWithEmail = await handleMint({
  store: classStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { multiUse: true, email: 'teacher@example.com', externalId: 'class-with-email' },
  now: NOW,
  randomBytes: () => Uint8Array.from({ length: 16 }, () => 8),
})
assert(classWithEmail.status === 400 && classWithEmail.body.error === 'multi_use_email', 'a class pass cannot be minted already bound to one email')
assert((await classStore.getExternal('class-with-email')) === null, 'rejected class mint does not keep an external id')

const exploding = {
  async get() {
    throw new Error('store')
  },
  async put() {
    throw new Error('store')
  },
  async getExternal() {
    throw new Error('store')
  },
  async putExternal() {
    throw new Error('store')
  },
}
const demo = await handleRedeem({
  store: exploding,
  body: { token: 'demo-sara-001', email: 'qa@example.com' },
})
assert(demo.status === 200 && demo.body.demo === true && demo.body.token === DEMO_TOKEN, 'demo pass redeems without the store')
const demoOther = await handleRedeem({
  store: exploding,
  body: { token: DEMO_TOKEN, email: 'second-qa@example.com' },
})
assert(
  demoOther.status === 200 && demoOther.body.demo === true && demoOther.body.multiUse === undefined,
  'demo pass stays multi-email and is not a class token',
)

const down = await handleRedeem({
  store: null,
  body: { token: 'SARA-ABCD-EFGH-JKLM-NPQR', email: 'buyer@example.com' },
})
assert(down.status === 503 && down.body.reason === 'redeem-unavailable', 'purchased pass without a store is unavailable')

let clashes = 0
const collisionStore = memoryRedeemStore()
const originalGet = collisionStore.get.bind(collisionStore)
collisionStore.get = async (token) => {
  clashes += 1
  if (clashes < 3) return { token, email: null, createdAt: NOW, usedAt: null, externalId: null }
  return originalGet(token)
}
let spins = 0
const collided = await handleMint({
  store: collisionStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { email: 'buyer@example.com' },
  now: NOW,
  randomBytes: () => {
    spins += 1
    return Uint8Array.from({ length: 16 }, () => spins)
  },
})
assert(collided.status === 201 && clashes >= 3, 'mint retries when a token already exists')

const kv = new Map()
const kvStore = kvRedeemStore({
  async get(key, type) {
    const value = kv.get(key)
    if (value == null) return null
    return type === 'json' ? JSON.parse(value) : value
  },
  async put(key, value) {
    kv.set(key, value)
  },
})
const viaKv = await dispatchRedeem('/redeem/mint', 'POST', {
  store: kvStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { email: 'kv@example.com', externalId: 'txn-kv' },
  now: NOW,
  randomBytes: () => fixedBytes,
})
const viaRedeem = await dispatchRedeem('/redeem', 'POST', {
  store: kvStore,
  body: { token: viaKv.body.token, email: 'kv@example.com' },
  now: NOW,
})
assert(viaKv.status === 201 && kv.has(`redeem:${viaKv.body.token}`) && kv.has('ext:txn-kv'), 'KV store keeps the pass and the purchase id')
assert(viaRedeem.status === 200 && viaRedeem.body.multiUse === false, 'KV pass validates on POST /redeem')
const legacyToken = formatToken(Uint8Array.from([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]))
kv.set(
  `redeem:${legacyToken}`,
  JSON.stringify({ token: legacyToken, email: 'legacy@example.com', createdAt: NOW, usedAt: null, externalId: null }),
)
const legacyOther = await handleRedeem({
  store: kvStore,
  body: { token: legacyToken, email: 'other@example.com' },
  now: NOW,
})
assert(legacyOther.status === 409 && legacyOther.body.reason === 'email-mismatch', 'KV records without multiUse stay single-email')
const classKv = await dispatchRedeem('/redeem/mint', 'POST', {
  store: kvStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { multiUse: true, externalId: 'class-cert-sac-2026-10-08' },
  now: NOW,
  randomBytes: () => classBytes,
})
const classKvAgain = await dispatchRedeem('/redeem/mint', 'POST', {
  store: kvStore,
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { multiUse: true, externalId: 'class-cert-sac-2026-10-08' },
  now: '2026-10-08T12:00:00.000Z',
  randomBytes: () => Uint8Array.from({ length: 16 }, () => 6),
})
const classRaw = kv.get(`redeem:${classKv.body.token}`)
const classStudent = await dispatchRedeem('/redeem', 'POST', {
  store: kvStore,
  body: { token: classKv.body.token, email: 'student.a@example.com' },
  now: NOW,
})
const classStudentTwo = await dispatchRedeem('/redeem', 'POST', {
  store: kvStore,
  body: { token: classKv.body.token, email: 'student.b@example.com' },
  now: NOW,
})
assert(
  classKv.status === 201 &&
    classKv.body.multiUse === true &&
    classKvAgain.status === 200 &&
    classKvAgain.body.idempotent === true &&
    classKvAgain.body.token === classKv.body.token,
  'KV class mint is idempotent for the same external id',
)
assert(
  typeof classRaw === 'string' &&
    classRaw.includes('"multiUse":true') &&
    !classRaw.includes('student') &&
    classRaw.includes('"email":null'),
  'KV class record stores multiUse and no student email',
)
assert(
  classStudent.status === 200 &&
    classStudentTwo.status === 200 &&
    kv.get(`redeem:${classKv.body.token}`) === classRaw,
  'KV class redeem leaves the shared record unchanged',
)
assert(kvRedeemStore(undefined) === null, 'missing KV binding is not a store')
assert((await dispatchRedeem('/redeem/mint', 'GET', {})) === null, 'mint is POST only')
assert(authorizeMint(headers({ authorization: 'Bearer' }), SECRET) === false, 'empty bearer is rejected')

const randomMint = await handleMint({
  store: memoryRedeemStore(),
  secret: SECRET,
  getHeader: headers({ authorization: `Bearer ${SECRET}` }),
  body: { email: 'random@example.com' },
  now: NOW,
})
assert(
  randomMint.status === 201 &&
    /^SARA-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/.test(randomMint.body.token),
  'mint draws a real token when entropy is not injected',
)

const workerKv = new Map()
const workerEnv = {
  REDEEM_MINT_SECRET: SECRET,
  XAI_TTS_VOICE: 'ara',
  SARA_PUBLIC_ORIGIN: PUBLIC_ORIGIN_DEFAULT,
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
const workerHealth = await askWorker.fetch(new Request('https://worker.test/health'), workerEnv)
const workerHealthBody = await workerHealth.json()
assert(workerHealthBody.ok === true && workerHealthBody.tts === 'ara' && workerHealthBody.redeem === true, 'Worker /health keeps Ask Sara fields and reports redeem')
const workerMint = await askWorker.fetch(
  new Request('https://worker.test/redeem/mint', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET}`,
      origin: 'https://sara-pfilates.surge.sh',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: 'buyer@example.com', externalId: 'txn-worker' }),
  }),
  workerEnv,
)
const workerMintBody = await workerMint.json()
assert(workerMint.status === 201 && String(workerMintBody.url).startsWith(`${PUBLIC_ORIGIN_DEFAULT}/r/`), 'Worker mint returns the public redeem link')
const workerRedeem = await askWorker.fetch(
  new Request('https://worker.test/redeem', {
    method: 'POST',
    headers: { origin: 'https://sara-pfilates.surge.sh', 'content-type': 'application/json' },
    body: JSON.stringify({ token: workerMintBody.token, email: 'buyer@example.com' }),
  }),
  workerEnv,
)
const workerRedeemBody = await workerRedeem.json()
assert(
  workerRedeem.status === 200 &&
    workerRedeemBody.ok === true &&
    workerRedeemBody.multiUse === false &&
    workerRedeem.headers.get('access-control-allow-origin') === 'https://sara-pfilates.surge.sh',
  'Worker redeem allows the phone demo origin',
)
const workerClass = await askWorker.fetch(
  new Request('https://worker.test/redeem/mint', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET}`,
      origin: 'https://sara-pfilates.surge.sh',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ multiUse: true, externalId: 'class-cert-sac-2026-10-08' }),
  }),
  workerEnv,
)
const workerClassBody = await workerClass.json()
const workerClassReplay = await askWorker.fetch(
  new Request('https://worker.test/redeem/mint', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ multiUse: true, externalId: 'class-cert-sac-2026-10-08' }),
  }),
  workerEnv,
)
const workerClassReplayBody = await workerClassReplay.json()
const workerClassA = await askWorker.fetch(
  new Request('https://worker.test/redeem', {
    method: 'POST',
    headers: { origin: 'https://sara-pfilates.surge.sh', 'content-type': 'application/json' },
    body: JSON.stringify({ token: workerClassBody.token, email: 'student.a@example.com' }),
  }),
  workerEnv,
)
const workerClassB = await askWorker.fetch(
  new Request('https://worker.test/redeem', {
    method: 'POST',
    headers: { origin: 'https://sara-pfilates.surge.sh', 'content-type': 'application/json' },
    body: JSON.stringify({ token: workerClassBody.token, email: 'student.b@example.com' }),
  }),
  workerEnv,
)
const workerClassRaw = workerKv.get(`redeem:${workerClassBody.token}`)
assert(
  workerClass.status === 201 &&
    workerClassBody.multiUse === true &&
    workerClassBody.url === `${PUBLIC_ORIGIN_DEFAULT}/r/${workerClassBody.token}` &&
    workerClassReplay.status === 200 &&
    workerClassReplayBody.idempotent === true &&
    workerClassReplayBody.token === workerClassBody.token,
  'Worker class mint keeps a stable public /r/{token} link',
)
assert(
  (await workerClassA.json()).ok === true &&
    (await workerClassB.json()).ok === true &&
    workerClassA.status === 200 &&
    workerClassB.status === 200 &&
    typeof workerClassRaw === 'string' &&
    workerClassRaw.includes('"multiUse":true') &&
    !workerClassRaw.includes('student'),
  'Worker class redeem accepts many emails and does not store them',
)
const workerAsk = await askWorker.fetch(
  new Request('https://worker.test/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://sara-pfilates.surge.sh' },
    body: JSON.stringify({ message: 'hello' }),
  }),
  workerEnv,
)
const workerAskBody = await workerAsk.json()
assert(typeof workerAskBody.reply === 'string' && workerAskBody.reply.length > 0, 'Worker /ask still answers when redeem routes are present')

const dir = await mkdtemp(join(tmpdir(), 'sara-redeem-'))
try {
  const file = join(dir, 'store.json')
  const first = createFileRedeemStore(file)
  const saved = await handleMint({
    store: first,
    secret: SECRET,
    getHeader: headers({ authorization: `Bearer ${SECRET}` }),
    body: { email: 'file@example.com', externalId: 'file-1' },
    now: NOW,
    randomBytes: () => fixedBytes,
  })
  const second = createFileRedeemStore(file)
  const loaded = await handleRedeem({
    store: second,
    body: { token: saved.body.token, email: 'file@example.com' },
    now: NOW,
  })
  assert(saved.status === 201 && loaded.status === 200, 'file store survives a process restart')
  const classFile = join(dir, 'class.json')
  const classFirst = createFileRedeemStore(classFile)
  const classSaved = await handleMint({
    store: classFirst,
    secret: SECRET,
    getHeader: headers({ authorization: `Bearer ${SECRET}` }),
    body: { multiUse: true, externalId: 'class-cert-sac-2026-10-08' },
    now: NOW,
    randomBytes: () => classBytes,
  })
  const classReloaded = createFileRedeemStore(classFile)
  const classLoadedA = await handleRedeem({
    store: classReloaded,
    body: { token: classSaved.body.token, email: 'student.a@example.com' },
    now: NOW,
  })
  const classLoadedB = await handleRedeem({
    store: classReloaded,
    body: { token: classSaved.body.token, email: 'student.b@example.com' },
    now: NOW,
  })
  const classOnDisk = JSON.parse(readFileSync(classFile, 'utf8'))
  const classDiskRecord = classOnDisk.tokens[classSaved.body.token]
  assert(
    classSaved.status === 201 &&
      classLoadedA.status === 200 &&
      classLoadedB.status === 200 &&
      classDiskRecord.multiUse === true &&
      classDiskRecord.email === null,
    'file store keeps a class pass unbound across a restart',
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, acc)
    else acc.push(path)
  }
  return acc
}

const srcHits = walk(join(root, 'src')).filter((path) => readFileSync(path, 'utf8').includes('REDEEM_MINT_SECRET'))
assert(srcHits.length === 0, 'Vite source never mentions REDEEM_MINT_SECRET')

const worker = readFileSync(join(root, 'worker/src/index.js'), 'utf8')
const nodeApi = readFileSync(join(root, 'server/index.mjs'), 'utf8')
const wrangler = readFileSync(join(root, 'worker/wrangler.toml'), 'utf8')
const redeemPage = readFileSync(join(root, 'src/pages/Redeem.tsx'), 'utf8')
const mock = readFileSync(join(root, 'src/lib/mockServer.ts'), 'utf8')
const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
assert(worker.includes("pathname === '/redeem/mint'") && worker.includes('dispatchRedeem'), 'Worker routes mint')
assert(worker.includes("pathname === '/redeem'") && nodeApi.includes("pathname === '/redeem'"), 'Worker and Node both validate redeem')
assert(/REDEEM_MINT_SECRET/.test(wrangler) && !/^REDEEM_MINT_SECRET\s*=/m.test(wrangler), 'mint secret is documented, not assigned, in wrangler.toml')
assert(
  /^\[\[kv_namespaces\]\]/m.test(wrangler) &&
    /^binding\s*=\s*"REDEEM_TOKENS"/m.test(wrangler) &&
    /^id\s*=\s*"6465ceb88c4b4fdfbc9cf0374588181d"/m.test(wrangler) &&
    !wrangler.includes('<paste id here>'),
  'REDEEM_TOKENS KV binding matches the live namespace',
)
assert(/DEMO_TOKEN = 'DEMO-SARA-001'/.test(mock) && /await confirmRemotePass/.test(mock), 'demo pass stays local and purchased passes call the Worker')
assert(/await redeemToken/.test(redeemPage) && /email-mismatch/.test(redeemPage) && /redeem-unavailable/.test(redeemPage), 'redeem page surfaces Worker results')
assert(vite.includes("'/redeem'"), 'Vite proxies /redeem to the local API')

const script = spawn(process.execPath, [join(root, 'scripts/mint-class-token.mjs'), '--self-test'])
let scriptOut = ''
script.stdout.on('data', (chunk) => {
  scriptOut += chunk
})
script.stderr.on('data', (chunk) => {
  scriptOut += chunk
})
const scriptCode = await new Promise((resolve) => script.on('close', resolve))
assert(scriptCode === 0 && /does not print the secret/.test(scriptOut), 'class mint script posts multiUse and hides the secret')

if (process.exitCode) {
  console.error('redeem smoke failed')
  process.exit(1)
}
console.log('redeem smoke passed')
