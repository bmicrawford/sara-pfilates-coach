import { readFileSync } from 'node:fs'
import { askSaraGrok, buildMessages, SARA_DEMO_AUDIENCE, SARA_NO_RED_FLAG, SARA_SYSTEM } from './askGrok.mjs'
import {
  DEMO_DAY_TTL_SECONDS,
  DEMO_HOUR_TTL_SECONDS,
  DEMO_LIMITS,
  SARA_BUSY_MESSAGE,
  UNKNOWN_PASS_MESSAGE,
  authorizePaidRequest,
  dayBucket,
  demoIpHash,
  hourBucket,
  memoryCounterStore,
  secondsUntilNextHour,
  secondsUntilNextUtcDay,
} from './demoGate.mjs'
import { memoryRedeemStore } from './redeem.mjs'
import { saraGuardrailPrompt } from './saraGuardrails.mjs'
import { saraKnowledgePrompt } from './saraKnowledge.mjs'
import { resetStreamKeyCache } from './streamSara.mjs'
import worker from '../worker/src/index.js'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

const NOW = Date.UTC(2026, 9, 23, 15, 30, 0)
const IP = '203.0.113.50'
const PAID = 'SARA-ABCD-EFGH-JKLM-NPQR'
const CLASS = 'SARA-WXYZ-2345-6789-ABCD'
const UNKNOWN = 'SARA-ZZZZ-ZZZZ-ZZZZ-ZZZZ'

assert(DEMO_LIMITS.askPerIpPerHour === 20, 'demo /ask hourly cap is 20')
assert(DEMO_LIMITS.speakPerIpPerHour === 60, 'demo /speak hourly cap is 60 so 3 chunks fit an ask')
assert(DEMO_LIMITS.askPerIpPerDay === 60, 'demo /ask daily cap is 60')
assert(DEMO_LIMITS.speakPerIpPerDay === 150, 'demo /speak daily cap is 150 so 3 chunks fit a day of asks')
assert(DEMO_LIMITS.globalAsksPerDay === 3000, 'global demo ask ceiling is 3000')
assert(DEMO_LIMITS.globalSpeaksPerDay === 3000, 'global demo speak ceiling is 3000')
assert(SARA_BUSY_MESSAGE === 'Sara is busy, please try again in a bit.', '429 copy is the friendly busy line')

function paidRecord(token, multiUse = false) {
  return {
    token,
    email: multiUse ? null : 'buyer@example.com',
    createdAt: '2026-10-23T00:00:00.000Z',
    usedAt: null,
    externalId: null,
    multiUse,
  }
}

async function allow(pass, endpoint, extra = {}) {
  return authorizePaidRequest({
    method: 'POST',
    pathname: endpoint,
    pass,
    redeemStore: extra.redeemStore,
    counterStore: extra.counterStore ?? memoryCounterStore(),
    ip: extra.ip ?? IP,
    nowMs: extra.nowMs ?? NOW,
    limits: extra.limits ?? DEMO_LIMITS,
  })
}

const missing = await allow('', '/ask')
assert(missing.allow === false && missing.status === 401 && missing.body.error === 'pass_required', 'missing pass is rejected')

const unknown = await allow(UNKNOWN, '/ask', { redeemStore: memoryRedeemStore() })
assert(
  unknown.allow === false && unknown.status === 403 && unknown.body.error === 'unknown_pass',
  'unknown pass is rejected',
)
assert(unknown.body.message === UNKNOWN_PASS_MESSAGE, 'unknown pass message is friendly')

const demoAsk = await allow('demo-sara-001', '/ask')
assert(demoAsk.allow === true && demoAsk.pass.kind === 'demo' && demoAsk.pass.voiceOnly === true, 'demo pass is voice-only')

const demoStream = await allow('DEMO-SARA-001', '/stream')
assert(
  demoStream.allow === false && demoStream.status === 403 && demoStream.body.error === 'demo_voice_only',
  'demo pass cannot open a talk stream',
)
const demoTalk = await authorizePaidRequest({
  method: 'GET',
  pathname: '/talk',
  pass: 'DEMO-SARA-001',
  counterStore: memoryCounterStore(),
  nowMs: NOW,
})
assert(demoTalk.allow === false && demoTalk.body.error === 'demo_voice_only', 'demo pass cannot open /talk')

const store = memoryRedeemStore()
await store.put(PAID, paidRecord(PAID))
await store.put(CLASS, paidRecord(CLASS, true))
const paid = await allow(PAID, '/stream', { redeemStore: store })
assert(paid.allow === true && paid.pass.kind === 'paid' && paid.pass.voiceOnly === false, 'paid pass keeps the talking-head path')
const klass = await allow(CLASS, '/ask', { redeemStore: store })
assert(klass.allow === true && klass.pass.kind === 'class' && klass.pass.voiceOnly === false, 'class pass is not demo-limited')

const tight = {
  ...DEMO_LIMITS,
  askPerIpPerHour: 2,
  askPerIpPerDay: 10,
  globalAsksPerDay: 10,
  speakPerIpPerHour: 2,
  speakPerIpPerDay: 10,
  globalSpeaksPerDay: 10,
}
const counters = memoryCounterStore()
const first = await allow('DEMO-SARA-001', '/ask', { counterStore: counters, limits: tight })
const second = await allow('DEMO-SARA-001', '/ask', { counterStore: counters, limits: tight })
const third = await allow('DEMO-SARA-001', '/ask', { counterStore: counters, limits: tight })
assert(first.allow && second.allow, 'requests under the hourly cap are allowed')
assert(
  third.allow === false &&
    third.status === 429 &&
    third.body.message === SARA_BUSY_MESSAGE &&
    third.body.reply === SARA_BUSY_MESSAGE &&
    third.body.scope === 'ip_hour' &&
    third.retryAfter === secondsUntilNextHour(NOW),
  'the next /ask over the hourly cap is 429 with Retry-After',
)
assert(third.retryAfter <= 3600, 'hourly Retry-After is within the hour')
const hourKey = [...counters.rows.keys()].find((key) => key.includes(':h:'))
assert(hourKey && counters.rows.get(hourKey).value === '2', 'a rejected request does not increment the counter')
assert(counters.rows.get(hourKey).ttlSeconds === DEMO_HOUR_TTL_SECONDS, 'hour keys use a short TTL')
assert([...counters.rows.keys()].every((key) => key.startsWith('rl:demo:')), 'limit keys stay in the rl:demo prefix')
assert([...counters.rows.keys()].every((key) => !key.includes(IP)), 'limit keys do not store the raw IP')
assert(!JSON.stringify(third.body).includes(IP), '429 body does not echo the IP')

const speakOk = await allow('DEMO-SARA-001', '/speak', { counterStore: counters, limits: tight })
assert(speakOk.allow === true, 'speak has its own counter from ask')

const dayCounters = memoryCounterStore()
const dayLimits = { ...DEMO_LIMITS, askPerIpPerHour: 20, askPerIpPerDay: 1, globalAsksPerDay: 3000 }
const dayOne = await allow('DEMO-SARA-001', '/ask', { counterStore: dayCounters, limits: dayLimits })
const dayTwo = await allow('DEMO-SARA-001', '/ask', { counterStore: dayCounters, limits: dayLimits })
assert(dayOne.allow === true, 'first ask of the day is allowed')
assert(
  dayTwo.status === 429 && dayTwo.body.scope === 'ip_day' && dayTwo.retryAfter === secondsUntilNextUtcDay(NOW),
  'per-IP daily cap returns 429',
)
const dayKey = [...dayCounters.rows.keys()].find((key) => key.includes(':d:'))
assert(dayCounters.rows.get(dayKey).ttlSeconds === DEMO_DAY_TTL_SECONDS, 'day keys expire within two days')

const globalCounters = memoryCounterStore()
const globalLimits = { ...DEMO_LIMITS, askPerIpPerHour: 20, askPerIpPerDay: 60, globalAsksPerDay: 1 }
const globalOne = await allow('DEMO-SARA-001', '/ask', {
  counterStore: globalCounters,
  limits: globalLimits,
  ip: '198.51.100.8',
})
const globalTwo = await allow('DEMO-SARA-001', '/ask', {
  counterStore: globalCounters,
  limits: globalLimits,
  ip: '198.51.100.9',
})
assert(globalOne.allow === true, 'global ceiling still allows the first ask')
assert(globalTwo.status === 429 && globalTwo.body.scope === 'global_day', 'global daily ceiling fails closed for every IP')

const paidCounters = memoryCounterStore()
for (let i = 0; i < 5; i++) {
  const again = await allow(PAID, '/ask', { redeemStore: store, counterStore: paidCounters, limits: tight })
  assert(again.allow === true, `paid pass is not demo-rate-limited (${i + 1})`)
}
assert(paidCounters.rows.size === 0, 'paid traffic does not write demo counter keys')

const demoPrompt = buildMessages('how much water?', [], { audience: 'demo' })[0].content
const guard = saraGuardrailPrompt()
const knowledge = saraKnowledgePrompt()
assert(demoPrompt.startsWith(SARA_SYSTEM), 'demo prompt keeps the full system text first')
assert(demoPrompt.indexOf(guard) < demoPrompt.indexOf(knowledge), 'guardrails stay ahead of research')
assert(demoPrompt.indexOf(knowledge) < demoPrompt.indexOf(SARA_DEMO_AUDIENCE), 'demo audience is after research')
assert(
  demoPrompt.indexOf(knowledge) < demoPrompt.indexOf(SARA_NO_RED_FLAG) &&
    demoPrompt.indexOf(SARA_NO_RED_FLAG) < demoPrompt.indexOf(SARA_DEMO_AUDIENCE),
  'no-trigger note stays after the guardrails and ahead of the demo audience',
)
assert(
  buildMessages('how much water?')[0].content === `${SARA_SYSTEM}\n\n${SARA_NO_RED_FLAG}`,
  'paid ordinary turns do not get the demo audience',
)
const pain = buildMessages('The lunge hurts when I do it.', [], { audience: 'demo' })[0].content
assert(!pain.includes(SARA_NO_RED_FLAG), 'a real pain turn does not get the no-trigger note')
const leadAt = pain.indexOf('Red-flag lead-in')
assert(leadAt > SARA_SYSTEM.length && leadAt < pain.indexOf(SARA_DEMO_AUDIENCE), 'red-flag lead-in stays ahead of the demo note')
assert(/Never diagnose/.test(demoPrompt), 'demo prompt still forbids diagnosis')
assert(!/74%/.test(SARA_DEMO_AUDIENCE), 'demo audience does not restate 74%')
assert(SARA_DEMO_AUDIENCE.includes("The women's course is a $149 lifetime purchase."), 'demo audience uses the approved price claim')
assert(SARA_DEMO_AUDIENCE.includes('It takes 10 minutes a day.'), 'demo audience uses the approved time claim')
assert(SARA_DEMO_AUDIENCE.includes('an AI coach, not a doctor'), 'demo audience says Sara is an AI coach, not a doctor')

const asked = await askSaraGrok({
  message: 'hello',
  apiKey: 'test-not-a-real-key',
  audience: 'demo',
  fetchFn: async (_url, init) => {
    const body = JSON.parse(init.body)
    assert(body.messages[0].content.startsWith(SARA_SYSTEM), 'outbound demo prompt starts with the unchanged system text')
    assert(body.messages[0].content.endsWith(SARA_DEMO_AUDIENCE), 'outbound demo prompt ends with the audience note')
    assert(!String(init.body).includes('test-not-a-real-key'), 'request body does not contain the API key')
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'It takes 10 minutes a day.' } }] }),
    }
  },
})
assert(asked.ok === true, 'demo audience still reaches Grok')

function memoryKv() {
  const rows = new Map()
  return {
    rows,
    async get(key, type) {
      const row = rows.get(key)
      if (!row) return null
      if (type === 'json') return JSON.parse(row.value)
      return row.value
    },
    async put(key, value, opts) {
      rows.set(key, { value: String(value), expirationTtl: opts?.expirationTtl ?? null })
    },
  }
}

const kv = memoryKv()
await kv.put(
  `redeem:${PAID}`,
  JSON.stringify(paidRecord(PAID)),
)
const env = {
  XAI_API_KEY: 'test-not-a-real-key',
  XAI_TTS_VOICE: 'ara',
  DID_API_KEY: 'test-did-key',
  DID_AGENT_ID: 'agt_test',
  REDEEM_TOKENS: kv,
}
const CLIENT_KEY = 'ck_test_stream_value'
const calls = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const href = String(url)
  calls.push(href)
  if (href.includes('api.d-id.com')) {
    return new Response(JSON.stringify({ client_key: CLIENT_KEY }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (href.includes('/chat/completions')) {
    const body = JSON.parse(init.body)
    assert(body.messages[0].content.includes(SARA_DEMO_AUDIENCE), 'worker demo /ask sends the audience note')
    assert(!JSON.stringify(init.headers).includes('DID_API_KEY'), 'chat headers are not the D-ID secret name')
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Ask me about PfilAtes.' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (href.includes('/tts')) {
    return new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    })
  }
  throw new Error('unexpected fetch')
}

async function post(pathname, pass, extraHeaders = {}) {
  return worker.fetch(
    new Request(`https://sara-pfilates-ask.example${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': IP,
        ...extraHeaders,
      },
      body: JSON.stringify({ message: 'hello', text: 'hello', pass }),
    }),
    env,
  )
}

try {
  resetStreamKeyCache()
  const beforeStream = calls.length
  const deniedStream = await post('/stream', 'DEMO-SARA-001')
  const deniedBody = await deniedStream.json()
  assert(deniedStream.status === 403 && deniedBody.error === 'demo_voice_only', 'worker refuses demo /stream')
  assert(calls.length === beforeStream, 'demo /stream does not call D-ID')
  assert(!JSON.stringify(deniedBody).includes(CLIENT_KEY), 'demo /stream does not return a client key')
  assert(!JSON.stringify(deniedBody).includes('test-did-key'), 'demo /stream does not leak the D-ID key')

  const deniedTalk = await post('/talk', 'DEMO-SARA-001')
  assert((await deniedTalk.json()).error === 'demo_voice_only', 'worker refuses demo /talk')
  assert(calls.length === beforeStream, 'demo /talk does not call D-ID or TTS')

  const talkGet = await worker.fetch(
    new Request('https://sara-pfilates-ask.example/talk?id=tlk_1&pass=DEMO-SARA-001', {
      headers: { 'CF-Connecting-IP': IP },
    }),
    env,
  )
  assert((await talkGet.json()).error === 'demo_voice_only', 'worker refuses demo talk polling')
  assert(calls.length === beforeStream, 'demo talk poll does not call D-ID')

  const missingPass = await post('/ask', '')
  assert(missingPass.status === 401, 'worker /ask requires a pass')
  assert(calls.length === beforeStream, 'missing pass does not call Grok')

  const unknownPass = await post('/ask', UNKNOWN)
  const unknownBody = await unknownPass.json()
  assert(unknownPass.status === 403 && unknownBody.error === 'unknown_pass', 'worker rejects an unknown pass')
  assert(calls.length === beforeStream, 'unknown pass does not call Grok')

  const paidStream = await post('/stream', PAID)
  const paidStreamBody = await paidStream.json()
  assert(paidStream.status === 200 && paidStreamBody.clientKey === CLIENT_KEY, 'paid pass can still mint a stream')
  assert(calls.some((href) => href.includes('api.d-id.com')), 'paid /stream reaches D-ID')

  const afterPaid = calls.length
  const demoAgain = await post('/stream', 'DEMO-SARA-001')
  const demoAgainBody = await demoAgain.json()
  assert(demoAgain.status === 403, 'a warm D-ID cache still does not open for demo')
  assert(!JSON.stringify(demoAgainBody).includes(CLIENT_KEY), 'cached client key is not handed to the demo pass')
  assert(calls.length === afterPaid, 'demo /stream does not use the cached mint')

  const ask = await post('/ask', 'DEMO-SARA-001')
  assert(ask.status === 200, 'demo /ask under the cap reaches Grok')

  const hash = await demoIpHash(IP)
  const hour = hourBucket(Date.now())
  const day = dayBucket(Date.now())
  await kv.put(`rl:demo:ask:h:${hash}:${hour}`, '20', { expirationTtl: DEMO_HOUR_TTL_SECONDS })
  const limited = await post('/ask', 'DEMO-SARA-001')
  const limitedBody = await limited.json()
  assert(limited.status === 429, 'worker returns 429 at the demo hourly cap')
  assert(limited.headers.get('Retry-After'), '429 includes Retry-After')
  assert(limitedBody.message === SARA_BUSY_MESSAGE, '429 JSON message is the busy line')
  const grokCallsAtLimit = calls.filter((href) => href.includes('/chat/completions')).length
  const stillLimited = await post('/ask', 'DEMO-SARA-001')
  assert(stillLimited.status === 429, 'further demo asks stay limited')
  assert(
    calls.filter((href) => href.includes('/chat/completions')).length === grokCallsAtLimit,
    'over-limit demo /ask does not call Grok',
  )

  await kv.put(`rl:demo:speak:h:${hash}:${hour}`, '60', { expirationTtl: DEMO_HOUR_TTL_SECONDS })
  const speakLimited = await post('/speak', 'DEMO-SARA-001')
  const speakBody = await speakLimited.json()
  assert(speakLimited.status === 429 && speakBody.message === SARA_BUSY_MESSAGE, 'worker returns 429 at the demo speak cap')
  assert(
    calls.filter((href) => href.includes('/tts')).length === 0,
    'over-limit demo /speak does not call TTS',
  )

  await kv.put(`rl:demo:ask:g:${day}`, '3000', { expirationTtl: DEMO_DAY_TTL_SECONDS })
  await kv.put(`rl:demo:ask:h:${hash}:${hour}`, '0', { expirationTtl: DEMO_HOUR_TTL_SECONDS })
  await kv.put(`rl:demo:ask:d:${hash}:${day}`, '0', { expirationTtl: DEMO_DAY_TTL_SECONDS })
  const ceiling = await post('/ask', 'DEMO-SARA-001', { 'CF-Connecting-IP': '198.51.100.20' })
  const ceilingBody = await ceiling.json()
  assert(
    ceiling.status === 429 && ceilingBody.scope === 'global_day',
    'global demo daily ceiling returns 429 for a fresh IP',
  )
} finally {
  globalThis.fetch = originalFetch
}

const workerSrc = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8')
const nodeSrc = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
assert(workerSrc.includes('authorizePaidRequest') && nodeSrc.includes('authorizePaidRequest'), 'Worker and Node share the paid gate')
assert(!/console\.(log|debug|info|warn|error)/.test(workerSrc), 'worker does not log requests or secrets')
assert(!workerSrc.includes('rl:demo:'), 'counter key format stays in the gate module')

if (process.exitCode) {
  console.error('demo gate smoke failed')
  process.exit(1)
}
console.log('demo gate smoke passed')
