import { clipSpeakText, speakSaraTts, SARA_VOICE, XAI_TTS_URL } from './speakSara.mjs'
import { talkSaraDid, DID_TALKS_URL, DID_AUDIOS_URL, SARA_STILL_URL } from './talkSara.mjs'

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
assert(noDid.ok === false && noDid.reason === 'missing_did_key', 'D-ID absent → no fake video')

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
    throw new Error(`unexpected ${url}`)
  },
})
assert(didMock.ok && /sara\.mp4$/.test(didMock.videoUrl), 'D-ID mock returns talking-head url')

if (process.exitCode) {
  console.error('speakSara smoke failed')
  process.exit(1)
}
console.log('speakSara smoke passed')
