import { readFileSync } from 'node:fs'
import { askSaraGrok, buildMessages, SARA_DEMO_AUDIENCE, SARA_NO_RED_FLAG, SARA_SYSTEM } from './askGrok.mjs'
import {
  DEMO_DAY_TTL_SECONDS,
  DEMO_DID_LEASE_TTL_SECONDS,
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
import { mintSaraStreamKey, resetStreamKeyCache } from './streamSara.mjs'
import { isDidCapacityResult } from './talkSara.mjs'
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
assert(DEMO_LIMITS.didPerIpPerHour === 3, 'demo D-ID cap is 3 sessions per IP per hour')
assert(DEMO_LIMITS.didPerIpPerDay === 6, 'demo D-ID cap is 6 sessions per IP per day')
assert(DEMO_LIMITS.globalDidPerDay === 150, 'global demo D-ID cap is 150 sessions per day')
assert(DEMO_LIMITS.didConcurrentMax === 2, 'demo D-ID allows 2 concurrent sessions')
assert(DEMO_DID_LEASE_TTL_SECONDS === 90, 'demo D-ID lease is a short 90s TTL')
assert(DEMO_LIMITS.askPerIpPerHour === 20 && DEMO_LIMITS.speakPerIpPerHour === 60, 'ask and speak caps stay put')
assert(SARA_BUSY_MESSAGE === 'Sara is busy, please try again in a bit.', '429 copy is the friendly busy line')
assert(isDidCapacityResult(403, { kind: 'Forbidden', description: 'Max user sessions reached' }), '403 max sessions is D-ID capacity')
assert(isDidCapacityResult(402, { kind: 'InsufficientCredits' }), '402 credits is D-ID capacity')
assert(isDidCapacityResult(429, { message: 'slow down' }), '429 from D-ID is capacity')
assert(!isDidCapacityResult(500, { kind: 'Forbidden' }), 'a 500 is not treated as the session cap')
assert(!isDidCapacityResult(401, { description: 'Unauthorized' }), 'a 401 is not the session cap')

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

{
const didCounters = memoryCounterStore()
const demoStream = await allow('DEMO-SARA-001', '/stream', { counterStore: didCounters })
assert(
  demoStream.allow === true && demoStream.pass.voiceOnly === true,
  'demo pass can open /stream and stays voiceOnly for the audience note',
)
assert(
  [...didCounters.rows.keys()].some((key) => key.startsWith('rl:demo:did:lease:')),
  'demo /stream takes a concurrency lease',
)
const demoTalkPost = await allow('DEMO-SARA-001', '/talk', { counterStore: didCounters })
assert(demoTalkPost.allow === true, 'demo pass can open POST /talk')
assert(
  [...didCounters.rows.keys()].filter((key) => key.startsWith('rl:demo:did:lease:')).length === 1,
  'POST /talk shares the did budget and does not take another lease',
)
const demoTalk = await authorizePaidRequest({
  method: 'GET',
  pathname: '/talk',
  pass: 'DEMO-SARA-001',
  counterStore: didCounters,
  nowMs: NOW,
})
assert(demoTalk.allow === true && demoTalk.pass.voiceOnly === true, 'demo GET /talk is allowed and is not a new session')
{
  const before = didCounters.rows.size
  await authorizePaidRequest({
    method: 'GET',
    pathname: '/talk/tlk_1',
    pass: 'DEMO-SARA-001',
    counterStore: didCounters,
    nowMs: NOW,
  })
  assert(didCounters.rows.size === before, 'demo talk polling does not write a new counter')
}

const didHour = memoryCounterStore()
for (let i = 0; i < DEMO_LIMITS.didPerIpPerHour; i += 1) {
  const ok = await allow('DEMO-SARA-001', '/talk', { counterStore: didHour, ip: '198.51.100.9' })
  assert(ok.allow === true, `demo D-ID session ${i + 1} under the hourly cap is allowed`)
}
const overHour = await allow('DEMO-SARA-001', '/stream', { counterStore: didHour, ip: '198.51.100.9' })
assert(
  overHour.allow === false &&
    overHour.status === 429 &&
    overHour.body.error === 'did_unavailable' &&
    overHour.body.message === '' &&
    overHour.body.reply === '' &&
    overHour.body.scope === 'ip_hour',
  'hourly D-ID cap returns a quiet 429',
)
assert(overHour.retryAfter > 0, 'hourly D-ID cap sets Retry-After')

const didDay = memoryCounterStore()
const dayLimits = { ...DEMO_LIMITS, didPerIpPerHour: 20, didPerIpPerDay: 2, globalDidPerDay: 20 }
const dayOne = await allow('DEMO-SARA-001', '/stream', { counterStore: didDay, limits: dayLimits, ip: '198.51.100.10' })
const dayTwo = await allow('DEMO-SARA-001', '/talk', { counterStore: didDay, limits: dayLimits, ip: '198.51.100.10' })
const dayThree = await allow('DEMO-SARA-001', '/stream', { counterStore: didDay, limits: dayLimits, ip: '198.51.100.10' })
assert(dayOne.allow && dayTwo.allow, 'stream and talk share the did daily budget')
assert(dayThree.allow === false && dayThree.body.scope === 'ip_day', 'per-IP daily D-ID cap is quiet')

const didGlobal = memoryCounterStore()
const globalLimits = { ...DEMO_LIMITS, didPerIpPerHour: 20, didPerIpPerDay: 20, globalDidPerDay: 1 }
const globalOne = await allow('DEMO-SARA-001', '/stream', { counterStore: didGlobal, limits: globalLimits, ip: '198.51.100.11' })
const globalTwo = await allow('DEMO-SARA-001', '/stream', {
  counterStore: didGlobal,
  limits: globalLimits,
  ip: '198.51.100.12',
})
assert(globalOne.allow === true, 'first global D-ID session is allowed')
assert(
  globalTwo.allow === false && globalTwo.body.error === 'did_unavailable' && globalTwo.body.scope === 'global_day',
  'global daily D-ID cap is 150 by default and overridable',
)

const leased = memoryCounterStore()
const leaseLimits = { ...DEMO_LIMITS, didConcurrentMax: 2, didPerIpPerHour: 20, didPerIpPerDay: 20, globalDidPerDay: 20 }
const slotA = await allow('DEMO-SARA-001', '/stream', { counterStore: leased, limits: leaseLimits, ip: '198.51.100.13' })
const slotB = await allow('DEMO-SARA-001', '/stream', { counterStore: leased, limits: leaseLimits, ip: '198.51.100.14' })
const slotC = await allow('DEMO-SARA-001', '/stream', { counterStore: leased, limits: leaseLimits, ip: '198.51.100.15' })
assert(slotA.allow && slotB.allow, 'two concurrent demo D-ID sessions fit the lease')
assert(
  slotC.allow === false && slotC.status === 429 && slotC.body.scope === 'concurrent' && slotC.body.message === '',
  'a third concurrent demo stream is a quiet 429 and does not call D-ID',
)
const expired = memoryCounterStore()
await expired.put('rl:demo:did:lease:0', String(NOW - 1000), DEMO_DID_LEASE_TTL_SECONDS)
await expired.put('rl:demo:did:lease:1', String(NOW - 1000), DEMO_DID_LEASE_TTL_SECONDS)
const reused = await allow('DEMO-SARA-001', '/stream', { counterStore: expired, limits: leaseLimits })
assert(reused.allow === true, 'an expired D-ID lease can be taken again')
const rateFirst = memoryCounterStore()
await rateFirst.put('rl:demo:did:lease:0', String(NOW + 60_000), DEMO_DID_LEASE_TTL_SECONDS)
await rateFirst.put('rl:demo:did:lease:1', String(NOW + 60_000), DEMO_DID_LEASE_TTL_SECONDS)
const didHourKey = `rl:demo:did:h:${await demoIpHash('198.51.100.16')}:${hourBucket(NOW)}`
await rateFirst.put(didHourKey, String(DEMO_LIMITS.didPerIpPerHour), DEMO_HOUR_TTL_SECONDS)
const rateBeforeLease = await allow('DEMO-SARA-001', '/stream', { counterStore: rateFirst, ip: '198.51.100.16' })
assert(rateBeforeLease.body.scope === 'ip_hour', 'the hourly cap is checked before a lease is taken')
assert(rateFirst.rows.get('rl:demo:did:lease:0').value === String(NOW + 60_000), 'a rate-limit deny does not rewrite the lease')
}

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
    if (globalThis.__didCapacity) {
      return new Response(
        JSON.stringify({ kind: 'Forbidden', description: 'Max user sessions reached' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    }
    if (href.includes('/audios')) {
      return new Response(JSON.stringify({ url: 'https://d-id.example/a.mp3' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (href.includes('/talks')) {
      return new Response(JSON.stringify({ id: 'tlk_demo', status: 'done', result_url: 'https://d-id.example/sara.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
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
  const demoStreamRes = await post('/stream', 'DEMO-SARA-001')
  const demoStreamBody = await demoStreamRes.json()
  assert(demoStreamRes.status === 200 && demoStreamBody.clientKey === CLIENT_KEY, 'worker mints a demo /stream client key')
  assert(calls.length > beforeStream && calls.some((href) => href.includes('api.d-id.com')), 'demo /stream calls D-ID under the cap')
  assert(!JSON.stringify(demoStreamBody).includes('test-did-key'), 'demo /stream does not leak the D-ID key')

  const demoTalkRes = await post('/talk', 'DEMO-SARA-001')
  const demoTalkBody = await demoTalkRes.json()
  assert(demoTalkRes.status === 200 && demoTalkBody.talkId, 'worker allows demo POST /talk under the cap')

  const talkGet = await worker.fetch(
    new Request('https://sara-pfilates-ask.example/talk?id=tlk_1&pass=DEMO-SARA-001', {
      headers: { 'CF-Connecting-IP': IP },
    }),
    env,
  )
  const talkGetBody = await talkGet.json()
  assert(talkGet.status === 200 && talkGetBody.error !== 'demo_voice_only', 'worker allows demo talk polling')

  const beforeMissing = calls.length
  const missingPass = await post('/ask', '')
  assert(missingPass.status === 401, 'worker /ask requires a pass')
  assert(calls.length === beforeMissing, 'missing pass does not call Grok')

  const beforeUnknown = calls.length
  const unknownPass = await post('/ask', UNKNOWN)
  const unknownBody = await unknownPass.json()
  assert(unknownPass.status === 403 && unknownBody.error === 'unknown_pass', 'worker rejects an unknown pass')
  assert(calls.length === beforeUnknown, 'unknown pass does not call Grok')

  const paidStream = await post('/stream', PAID)
  const paidStreamBody = await paidStream.json()
  assert(paidStream.status === 200 && paidStreamBody.clientKey === CLIENT_KEY, 'paid pass can still mint a stream')
  assert(calls.some((href) => href.includes('api.d-id.com')), 'paid /stream reaches D-ID')

  const hashDid = await demoIpHash(IP)
  const didHourNow = hourBucket(Date.now())
  const didDayNow = dayBucket(Date.now())
  await kv.put(`rl:demo:did:h:${hashDid}:${didHourNow}`, '3', { expirationTtl: DEMO_HOUR_TTL_SECONDS })
  const didCallsAtCap = calls.length
  const didLimited = await post('/stream', 'DEMO-SARA-001')
  const didLimitedBody = await didLimited.json()
  assert(
    didLimited.status === 429 &&
      didLimitedBody.error === 'did_unavailable' &&
      didLimitedBody.message === '' &&
      didLimited.headers.get('Retry-After'),
    'worker returns a quiet 429 at the demo D-ID hourly cap',
  )
  assert(calls.length === didCallsAtCap, 'a capped demo /stream does not call D-ID')

  await kv.put(`rl:demo:did:h:${hashDid}:${didHourNow}`, '0', { expirationTtl: DEMO_HOUR_TTL_SECONDS })
  await kv.put(`rl:demo:did:lease:0`, String(Date.now() + 60_000), { expirationTtl: DEMO_DID_LEASE_TTL_SECONDS })
  await kv.put(`rl:demo:did:lease:1`, String(Date.now() + 60_000), { expirationTtl: DEMO_DID_LEASE_TTL_SECONDS })
  const leaseCalls = calls.length
  const leaseFull = await post('/stream', 'DEMO-SARA-001')
  const leaseBody = await leaseFull.json()
  assert(
    leaseFull.status === 429 && leaseBody.error === 'did_unavailable' && leaseBody.scope === 'concurrent',
    'worker returns a quiet 429 when the demo D-ID lease is full',
  )
  assert(calls.length === leaseCalls, 'a full lease does not call D-ID')
  await kv.put(`rl:demo:did:lease:0`, String(Date.now() - 1000), { expirationTtl: DEMO_DID_LEASE_TTL_SECONDS })
  await kv.put(`rl:demo:did:lease:1`, String(Date.now() - 1000), { expirationTtl: DEMO_DID_LEASE_TTL_SECONDS })

  await kv.put(`rl:demo:did:g:${didDayNow}`, '150', { expirationTtl: DEMO_DAY_TTL_SECONDS })
  await kv.put(`rl:demo:did:h:${hashDid}:${didHourNow}`, '0', { expirationTtl: DEMO_HOUR_TTL_SECONDS })
  const globalDid = await post('/stream', 'DEMO-SARA-001', { 'CF-Connecting-IP': '198.51.100.40' })
  const globalDidBody = await globalDid.json()
  assert(
    globalDid.status === 429 && globalDidBody.error === 'did_unavailable' && globalDidBody.scope === 'global_day',
    'global demo D-ID ceiling returns a quiet 429',
  )
  await kv.put(`rl:demo:did:g:${didDayNow}`, '0', { expirationTtl: DEMO_DAY_TTL_SECONDS })

  resetStreamKeyCache()
  globalThis.__didCapacity = true
  const capacityCalls = calls.length
  const capacity = await post('/stream', 'DEMO-SARA-001', { 'CF-Connecting-IP': '198.51.100.41' })
  const capacityBody = await capacity.json()
  assert(
    capacity.status === 429 && capacityBody.error === 'did_unavailable' && !capacityBody.clientKey,
    'D-ID max-sessions 403 becomes a quiet 429 so the phone falls back',
  )
  assert(calls.length > capacityCalls, 'the worker asks D-ID before mapping a capacity error')
  assert(!JSON.stringify(capacityBody).includes('test-did-key'), 'capacity 429 does not leak the D-ID key')
  globalThis.__didCapacity = false
  resetStreamKeyCache()

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
  const ttsBeforeSpeakCap = calls.filter((href) => href.includes('/tts')).length
  const speakLimited = await post('/speak', 'DEMO-SARA-001')
  const speakBody = await speakLimited.json()
  assert(speakLimited.status === 429 && speakBody.message === SARA_BUSY_MESSAGE, 'worker returns 429 at the demo speak cap')
  assert(
    calls.filter((href) => href.includes('/tts')).length === ttsBeforeSpeakCap,
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
