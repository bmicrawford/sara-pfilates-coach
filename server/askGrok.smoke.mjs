import { readFileSync } from 'node:fs'
import { askSaraGrok, buildMessages, corsHeaders, SARA_OFFLINE, SARA_SYSTEM, GROK_MODEL } from './askGrok.mjs'
import {
  APPROVED_CLAIMS,
  ESSENTIAL_PFILATES_MOVEMENTS,
  PFILATES_MOVEMENTS,
  RED_FLAG_QA_CASES,
  RED_FLAG_QA_NON_MATCHES,
  RED_FLAG_RULES,
  matchingRedFlags,
  saraGuardrailPrompt,
} from './saraGuardrails.mjs'

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
assert(/a few short paragraphs at most/.test(SARA_SYSTEM), 'response length guidance unchanged')
assert(SARA_SYSTEM.includes(saraGuardrailPrompt()), 'system prompt includes Dr C guardrails')
assert(
  /do not invent statistics, studies, cure claims, or diagnoses/i.test(SARA_SYSTEM),
  'claims whitelist forbids invented stats, studies, cures, and diagnoses',
)
assert(
  /do not replace an evaluation by a medical provider/i.test(SARA_SYSTEM),
  'Sara does not replace a medical evaluation',
)
assert(
  /sit alongside the \$149 Kajabi course and do not replace it/i.test(SARA_SYSTEM),
  'Sara sits alongside the Kajabi course',
)
assert(/do not invent step-by-step instructions/i.test(SARA_SYSTEM), 'no invented movement instructions')
assert(
  /do not add other conditions or advice beyond these rules/i.test(SARA_SYSTEM),
  'no extra red-flag conditions',
)
assert(/after 12 weeks gestational age/i.test(SARA_SYSTEM), 'pregnancy limit is after 12 weeks')
assert(PFILATES_MOVEMENTS.length === 10, 'ten PfilAtes movements')
assert(ESSENTIAL_PFILATES_MOVEMENTS.length === 5, 'five essential movements')
for (const name of ESSENTIAL_PFILATES_MOVEMENTS) {
  assert(PFILATES_MOVEMENTS.includes(name), `essential movement is one of the ten: ${name}`)
}
for (const name of PFILATES_MOVEMENTS) {
  assert(SARA_SYSTEM.includes(name), `movement name in prompt: ${name}`)
}
assert(
  SARA_SYSTEM.includes(
    `The Essential PfilAtes Movements are ${ESSENTIAL_PFILATES_MOVEMENTS.slice(0, -1).join(', ')}, and ${ESSENTIAL_PFILATES_MOVEMENTS.at(-1)}.`,
  ),
  'essential movements named exactly',
)
for (const claim of APPROVED_CLAIMS) {
  assert(SARA_SYSTEM.includes(claim), `approved claim in prompt: ${claim}`)
}
for (const rule of RED_FLAG_RULES) {
  assert(SARA_SYSTEM.includes(rule.instruction), `red-flag rule in prompt: ${rule.id}`)
}
assert(
  SARA_SYSTEM.includes('If a movement at any time causes pain, stop that movement.'),
  'movement pain stop rule uses Dr C wording',
)

const qaDoc = readFileSync(new URL('../docs/sara-red-flag-qa.md', import.meta.url), 'utf8')
for (const claim of APPROVED_CLAIMS) {
  assert(qaDoc.includes(claim), `QA doc lists claim: ${claim}`)
}
for (const rule of RED_FLAG_RULES) {
  assert(qaDoc.includes(rule.instruction), `QA doc lists rule: ${rule.id}`)
}
for (const name of PFILATES_MOVEMENTS) {
  assert(qaDoc.includes(name), `QA doc lists movement: ${name}`)
}
for (const sample of RED_FLAG_QA_CASES) {
  const rule = RED_FLAG_RULES.find((item) => item.id === sample.ruleId)
  assert(rule, `QA case ${sample.id} points at a rule`)
  assert(qaDoc.includes(sample.prompt), `QA doc lists prompt: ${sample.id}`)
  const hits = matchingRedFlags(sample.prompt)
  assert(hits.some((item) => item.id === sample.ruleId), `${sample.id} matches ${sample.ruleId}`)
  const builtCase = buildMessages(sample.prompt)
  const lead = builtCase[0].content.slice(SARA_SYSTEM.length)
  assert(lead.includes('Red-flag lead-in'), `${sample.id} adds a red-flag lead-in`)
  assert(lead.includes(rule.instruction), `${sample.id} lead-in uses Dr C wording`)
}
for (const prompt of RED_FLAG_QA_NON_MATCHES) {
  assert(qaDoc.includes(prompt), `QA doc lists non-match: ${prompt}`)
  assert(matchingRedFlags(prompt).length === 0, `no red-flag match for: ${prompt}`)
  assert(buildMessages(prompt)[0].content === SARA_SYSTEM, `no red-flag lead-in for: ${prompt}`)
}

assert(
  matchingRedFlags('Side-lying bent knee lift hurts.').some((rule) => rule.id === 'movement-pain'),
  'hyphenated movement name still counts as pain',
)
assert(
  matchingRedFlags('side lying bent knee lift hurts').some((rule) => rule.id === 'movement-pain'),
  'spaced side lying name still counts as pain',
)
assert(
  matchingRedFlags('cat cow is painful').some((rule) => rule.id === 'movement-pain'),
  'spaced cat cow still counts as pain',
)

const combined = "I'm pregnant and the butterfly hurts."
const combinedIds = matchingRedFlags(combined).map((rule) => rule.id)
assert(
  combinedIds[0] === 'movement-pain' && combinedIds.includes('pregnancy'),
  'pain rule stays ahead of the pregnancy rule',
)
const combinedLead = buildMessages(combined)[0].content.slice(SARA_SYSTEM.length)
assert(
  combinedLead.indexOf('stop that movement') !== -1 &&
    combinedLead.indexOf('stop that movement') < combinedLead.indexOf('after 12 weeks gestational age'),
  'combined lead-in states pain before the pregnancy limit',
)

const built = buildMessages('how much water?', [
  { from: 'you', text: 'hi' },
  { from: 'sara', text: 'hey' },
])
assert(built[0].role === 'system' && built[0].content === SARA_SYSTEM, 'system message first')
assert(built.at(-1).content === 'how much water?', 'latest user message last')
assert(built.some((m) => m.role === 'assistant'), 'history maps sara → assistant')

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
    assert(
      body.messages[0].content.includes('74% bladder symptom improvement'),
      'sends the approved-claims whitelist',
    )
    assert(
      body.messages[0].content.includes('If a movement at any time causes pain, stop that movement.'),
      'sends Dr C red-flag rules',
    )
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
