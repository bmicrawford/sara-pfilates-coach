import { clipSpeakText, speakSaraTts, SARA_VOICE, XAI_TTS_URL } from './speakSara.mjs'
import {
  talkSaraDid,
  getSaraTalk,
  talkIdFromUrl,
  isTalkPath,
  talkStartResponse,
  talkPollResponse,
  DID_TALKS_URL,
  DID_AUDIOS_URL,
  SARA_STILL_URL,
} from './talkSara.mjs'
import {
  mintSaraStreamKey,
  streamStartResponse,
  saraAgentCreateBody,
  resetStreamKeyCache,
  STREAM_ALLOWED_DOMAINS,
  STREAM_TTL_SECONDS,
  DID_AGENTS_URL,
} from './streamSara.mjs'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(SARA_VOICE === 'ara', 'warm adult female voice is ara')
assert(XAI_TTS_URL.includes('/v1/tts'), 'xAI TTS path')
assert(clipSpeakText('  hello   there  ') === 'hello there', 'clips/collapses speak text')
assert(clipSpeakText('x'.repeat(5000)).length === 4000, 'caps speak length')
assert(
  clipSpeakText('Try this PfilAtes squeeze.') === 'Try this fill-ah-tees squeeze.',
  'ara /speak rewrites PfilAtes before TTS',
)
assert(clipSpeakText('pfilates') === 'fill-ah-tees', 'rewrite is case-insensitive')
assert(clipSpeakText('Pilates class') === 'Pilates class', 'does not rewrite Pilates')
assert(
  SARA_STILL_URL === 'https://sara-pfilates.surge.sh/avatar/sara-default.png',
  'default still is the live Surge avatar',
)
assert(isTalkPath('/talk') && isTalkPath('/talk/abc') && !isTalkPath('/talks'), 'talk paths')
assert(talkIdFromUrl(new URL('http://x/talk?id=tlk_1')) === 'tlk_1', 'talk id from query')
assert(talkIdFromUrl(new URL('http://x/talk/tlk_2')) === 'tlk_2', 'talk id from path')
assert(talkIdFromUrl(new URL('http://x/talk')) === '', 'missing talk id is empty')

const missing = await speakSaraTts({ text: 'hello', apiKey: '' })
assert(missing.ok === false && missing.status === 503, 'missing XAI key → no fake voice')

const mocked = await speakSaraTts({
  text: 'Sip water through the day — not a chug before bed.',
  apiKey: 'test-not-a-real-key',
  fetchFn: async (url, init) => {
    const body = JSON.parse(init.body)
    assert(url === XAI_TTS_URL, 'calls xAI TTS')
    assert(init.headers.Authorization === 'Bearer test-not-a-real-key', 'Bearer from env, not the bundle')
    assert(body.voice_id === 'ara', 'requests ara')
    assert(body.language === 'en', 'English')
    assert(/water/.test(body.text), 'forwards reply text')
    return {
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }
  },
})
assert(mocked.ok && mocked.audio.byteLength === 4 && mocked.contentType === 'audio/mpeg', 'returns audio bytes')

const down = await speakSaraTts({
  text: 'hello',
  apiKey: 'x',
  fetchFn: async () => {
    throw new Error('network')
  },
})
assert(down.ok === false, 'TTS network failure is honest')

const noDid = await talkSaraDid({
  audio: new Uint8Array([1]),
  apiKey: '',
})
assert(noDid.ok === false && noDid.reason === 'missing_did_key' && !noDid.talkId, 'D-ID absent → no fake video')
assert(talkStartResponse(noDid).videoUrl === null, 'missing key start payload has null video')

let pollCalls = 0
const didMock = await talkSaraDid({
  audio: new Uint8Array([9, 8, 7]),
  apiKey: 'did-test-key',
  fetchFn: async (url, init) => {
    if (url === DID_AUDIOS_URL) {
      assert(/Basic /.test(init.headers.Authorization), 'D-ID uses Basic auth from DID_API_KEY')
      return { ok: true, json: async () => ({ url: 'https://d-id.example/a.mp3' }) }
    }
    if (url === DID_TALKS_URL) {
      const body = JSON.parse(init.body)
      assert(body.source_url === SARA_STILL_URL, 'talks from locked Sara still')
      assert(body.script.type === 'audio', 'uses uploaded neural audio, not D-ID TTS')
      return { ok: true, json: async () => ({ id: 'talk_1', result_url: 'https://d-id.example/sara.mp4' }) }
    }
    pollCalls += 1
    throw new Error(`unexpected ${url}`)
  },
})
assert(didMock.ok && didMock.talkId === 'talk_1' && /sara\.mp4$/.test(didMock.videoUrl), 'create returns talkId + video if D-ID already has it')
assert(pollCalls === 0, 'create does not poll D-ID for the mp4')

const didAsync = await talkSaraDid({
  audio: new Uint8Array([1, 2]),
  apiKey: 'did-test-key',
  fetchFn: async (url) => {
    if (url === DID_AUDIOS_URL) {
      return { ok: true, json: async () => ({ url: 'https://d-id.example/a.mp3' }) }
    }
    if (url === DID_TALKS_URL) {
      return { ok: true, json: async () => ({ id: 'talk_slow', status: 'created' }) }
    }
    throw new Error(`create must not wait on ${url}`)
  },
})
assert(didAsync.ok && didAsync.talkId === 'talk_slow' && !didAsync.videoUrl, 'create returns talkId without blocking ~2 minutes')

const pending = await getSaraTalk({
  id: 'talk_slow',
  apiKey: 'did-test-key',
  fetchFn: async (url, init) => {
    assert(url === `${DID_TALKS_URL}/talk_slow`, 'GET talks/:id once')
    assert(/Basic /.test(init.headers.Authorization), 'poll uses Basic auth')
    return { ok: true, json: async () => ({ id: 'talk_slow', status: 'started' }) }
  },
})
assert(pending.ok && pending.status === 'started' && !pending.videoUrl, 'one GET can be pending')
assert(talkPollResponse(pending).status === 'started', 'poll payload keeps pending status')

const done = await getSaraTalk({
  id: 'talk_slow',
  apiKey: 'did-test-key',
  fetchFn: async () => ({
    ok: true,
    json: async () => ({ status: 'done', result_url: 'https://d-id.example/sara.mp4' }),
  }),
})
assert(done.ok && done.status === 'done' && /sara\.mp4$/.test(done.videoUrl), 'done GET returns videoUrl')

const errored = await getSaraTalk({
  id: 'talk_bad',
  apiKey: 'did-test-key',
  fetchFn: async () => ({ ok: true, json: async () => ({ status: 'error' }) }),
})
assert(errored.ok === false && errored.status === 'error' && !errored.videoUrl, 'D-ID error is honest')

const noPollKey = await getSaraTalk({ id: 'talk_1', apiKey: '' })
assert(noPollKey.reason === 'missing_did_key' && !noPollKey.videoUrl, 'GET without key does not crash')

resetStreamKeyCache()
const noStreamKey = await mintSaraStreamKey({ apiKey: '', agentId: 'agt_1' })
assert(noStreamKey.reason === 'missing_did_key' && !noStreamKey.clientKey, 'stream mint without DID key is honest')

const noAgent = await mintSaraStreamKey({ apiKey: 'did-test-key', agentId: '' })
assert(noAgent.reason === 'missing_agent_id' && !noAgent.clientKey, 'stream mint without agent id is honest')

const createdAgent = saraAgentCreateBody()
assert(createdAgent.presenter.type === 'talk', 'Sara agent is a Talks V2 photo presenter')
assert(createdAgent.presenter.source_url === SARA_STILL_URL, 'agent uses the locked Sara still')
assert(createdAgent.presenter.thumbnail === SARA_STILL_URL, 'agent thumbnail is the same still')
assert(createdAgent.embed === true, 'agent is embeddable for the Agents SDK')
assert(!createdAgent.llm, 'D-ID agent has no LLM — Grok stays on our Worker')
assert(STREAM_TTL_SECONDS >= 60 && STREAM_TTL_SECONDS <= 3600, 'client key TTL is short-lived')
assert(
  STREAM_ALLOWED_DOMAINS.includes('https://sara-pfilates.surge.sh') &&
    STREAM_ALLOWED_DOMAINS.includes('https://sara-pfilates-coach.surge.sh'),
  'stream client key allows both Surge hosts',
)

let mintCalls = 0
const minted = await mintSaraStreamKey({
  apiKey: 'did-test-key',
  agentId: 'agt_sara',
  now: () => 1_000,
  fetchFn: async (url, init) => {
    mintCalls += 1
    assert(url === `${DID_AGENTS_URL}/agt_sara/client-keys`, 'mints POST /agents/:id/client-keys')
    assert(/Basic /.test(init.headers.Authorization), 'stream mint uses DID_API_KEY Basic auth')
    const body = JSON.parse(init.body)
    assert(body.ttl_seconds === STREAM_TTL_SECONDS, 'mints a short-lived key')
    assert(body.allowed_domains.includes('https://sara-pfilates.surge.sh'), 'key allowlist includes current Surge')
    return {
      ok: true,
      json: async () => ({
        client_key: 'ck_test_not_a_real_key',
        allowed_domains: body.allowed_domains,
        expires_at: '1970-01-01T00:10:01.000Z',
      }),
    }
  },
})
assert(minted.ok && minted.clientKey === 'ck_test_not_a_real_key' && minted.agentId === 'agt_sara', 'mint returns clientKey + agentId')
assert(streamStartResponse(minted).clientKey === 'ck_test_not_a_real_key', 'stream payload never includes DID_API_KEY')
assert(!JSON.stringify(streamStartResponse(minted)).includes('did-test-key'), 'DID_API_KEY is not in the client payload')

const cached = await mintSaraStreamKey({
  apiKey: 'did-test-key',
  agentId: 'agt_sara',
  now: () => 2_000,
  fetchFn: async () => {
    throw new Error('should use cache')
  },
})
assert(cached.ok && cached.clientKey === minted.clientKey && mintCalls === 1, 'reuses short-lived key until near expiry')

if (process.exitCode) {
  console.error('speakSara smoke failed')
  process.exit(1)
}
console.log('speakSara smoke passed')
