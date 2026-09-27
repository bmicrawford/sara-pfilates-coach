import { askSaraGrok, buildMessages, corsHeaders, SARA_OFFLINE, SARA_SYSTEM, GROK_MODEL } from './askGrok.mjs'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(GROK_MODEL === 'grok-4.6', 'model id is grok-4.6')
assert(
  corsHeaders('https://sara-pfilates.surge.sh')['Access-Control-Allow-Origin'] ===
    'https://sara-pfilates.surge.sh',
  'CORS allows current phone demo origin',
)
assert(
  corsHeaders('https://sara-pfilates-coach.surge.sh')['Access-Control-Allow-Origin'] ===
    'https://sara-pfilates-coach.surge.sh',
  'CORS still allows the older Surge origin',
)
assert(/never use the casual word "stress"/i.test(SARA_SYSTEM), 'system prompt forbids casual stress')
assert(!/reduce stress|don't stress|less stress/i.test(SARA_SYSTEM), 'prompt does not coach "stress" as a lifestyle word')
assert(/Kajabi/.test(SARA_SYSTEM), 'course stays on Kajabi')
assert(/UTI/.test(SARA_SYSTEM) && /do not diagnose|Never diagnose/i.test(SARA_SYSTEM), 'UTI: no diagnosis')
assert(/three/i.test(SARA_SYSTEM), 'session cap mentioned')
assert(/pelvic pain/i.test(SARA_SYSTEM), 'pelvic pain stop rule')

const built = buildMessages('how much water?', [
  { from: 'you', text: 'hi' },
  { from: 'sara', text: 'hey' },
])
assert(built[0].role === 'system' && built[0].content === SARA_SYSTEM, 'system message first')
assert(built.at(-1).content === 'how much water?', 'latest user message last')
assert(built.some((m) => m.role === 'assistant'), 'history maps sara → assistant')
assert(built.filter((m) => m.role === 'system').length === 1, 'no extra system note without context')

const withContext = buildMessages('hello', [], 'Everyday movements: Lunge; Bridge')
assert(withContext[0].content === SARA_SYSTEM, 'movement context does not rewrite the Sara system prompt')
assert(
  withContext[1]?.role === 'system' && withContext[1].content.includes('Lunge'),
  'everyday movement context is a second system note',
)
assert(withContext.at(-1).content === 'hello', 'user message stays last when context is set')

const contextSent = await askSaraGrok({
  message: 'what should I do today?',
  context: 'Everyday movements: Lunge; Bridge',
  apiKey: 'test-not-a-real-key',
  fetchFn: async (_url, init) => {
    const body = JSON.parse(init.body)
    const notes = body.messages.filter((message) => message.role === 'system')
    assert(notes.length === 2, 'ask sends the worksheet context beside the system prompt')
    assert(notes[1].content.includes('Bridge'), 'ask forwards the everyday movement names')
    assert(!notes[0].content.includes('Bridge'), 'base Sara prompt stays free of the worksheet note')
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Those two, as you learned them.' } }] }) }
  },
})
assert(contextSent.ok, 'context ask still returns the model reply')

const missing = await askSaraGrok({ message: 'hello', apiKey: '' })
assert(missing.reply === SARA_OFFLINE && missing.ok === false, 'missing key → honest offline line')

const mocked = await askSaraGrok({
  message: 'why did I leak when I sneezed?',
  apiKey: 'test-not-a-real-key',
  fetchFn: async (url, init) => {
    const body = JSON.parse(init.body)
    assert(url.includes('api.x.ai/v1/chat/completions'), 'calls xAI chat completions')
    assert(init.headers.Authorization === 'Bearer test-not-a-real-key', 'Bearer from env, not hardcoded')
    assert(body.model === 'grok-4.6', 'sends grok-4.6')
    assert(body.messages[0].content.includes('Never diagnose'), 'sends Sara system prompt')
    assert(body.messages.at(-1).content.includes('sneezed'), 'forwards the user question')
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'A sneeze is a sudden downward push, so a leak then is often a timing thing — not a verdict. I am not diagnosing anything; log it and keep squeezes gentle.',
            },
          },
        ],
      }),
    }
  },
})
assert(mocked.ok && /sneeze|timing/.test(mocked.reply), 'mock Grok reply is on-topic')

const down = await askSaraGrok({
  message: 'hello',
  apiKey: 'x',
  fetchFn: async () => {
    throw new Error('network')
  },
})
assert(down.reply === SARA_OFFLINE, 'network failure → honest offline line, not a keyword stub')

if (process.exitCode) {
  console.error('askGrok smoke failed')
  process.exit(1)
}
console.log('askGrok smoke passed')
