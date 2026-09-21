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
assert(redeemed.status === 200 && redeemed.body.ok === true, 'matching email redeems')
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
assert(viaRedeem.status === 200, 'KV pass validates on POST /redeem')
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
    workerRedeem.headers.get('access-control-allow-origin') === 'https://sara-pfilates.surge.sh',
  'Worker redeem allows the phone demo origin',
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

if (process.exitCode) {
  console.error('redeem smoke failed')
  process.exit(1)
}
console.log('redeem smoke passed')
