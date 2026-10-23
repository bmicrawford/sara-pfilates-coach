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
import {
  RESEARCH_ALLOWED_PERCENTS,
  RESEARCH_FACTS,
  RESEARCH_QA_CASES,
  researchReplyIssues,
  saraKnowledgePrompt,
} from './saraKnowledge.mjs'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

/** 74% may appear only as the 2023 Evergreen Commons senior result, or in a ban on quoting it for community women. */
function seventyFourProblems(text) {
  const problems = []
  for (const line of String(text).split(/\n+/)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (!sentence.includes('74%')) continue
      const mentionsCommunity = /community(?:-|\s)dwelling women|community women/i.test(sentence)
      const negated = /(?:never|do not|don't|must not|not be quoted|not quote|do not pair|not a result)/i.test(
        sentence,
      )
      const seniorLabeled = /2023 Evergreen Commons/.test(sentence) && /senior/i.test(sentence)
      if (mentionsCommunity && !negated) problems.push(sentence.trim())
      else if (!seniorLabeled && !negated) problems.push(sentence.trim())
    }
  }
  return problems
}

assert(GROK_MODEL === 'grok-4.20-0309-non-reasoning', 'model id is the non-reasoning grok-4.20')
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
assert(/2 to 4 short sentences/.test(SARA_SYSTEM), 'voice replies are 2 to 4 short sentences')
assert(/no lists/.test(SARA_SYSTEM), 'voice replies have no lists')
assert(
  SARA_SYSTEM.indexOf('2 to 4 short sentences') < SARA_SYSTEM.indexOf(saraGuardrailPrompt()),
  'voice style stays ahead of the guardrails',
)
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

// PfilAtes research knowledge (docs/pfilates-research.md)
const knowledge = saraKnowledgePrompt()
assert(SARA_SYSTEM.includes(knowledge), 'system prompt includes PfilAtes research knowledge')
assert(
  SARA_SYSTEM.indexOf(saraGuardrailPrompt()) < SARA_SYSTEM.indexOf(knowledge),
  'red-flag guardrails come before research knowledge',
)
assert(/Red-flag rules always come first/.test(knowledge), 'research block defers to red-flag rules')
assert(/I don't know of a PfilAtes study on that/.test(knowledge), 'research block says "I don\'t know" for unknown studies')
assert(/never say proven or cure/i.test(knowledge), 'research block bans overstatement')
assert(/up to 10x a standard Kegel/.test(knowledge), '10x is allowed only in the confirmed phrase')
assert(PFILATES_MOVEMENTS[8] === 'All Fours Side Leg Lift', 'movement 9 is All Fours Side Leg Lift')
assert(SARA_SYSTEM.includes('All Fours Side Leg Lift'), 'prompt uses All Fours Side Leg Lift')
assert(!SARA_SYSTEM.includes('All-4s side leg lift'), 'old All-4s side leg lift name is gone')
assert(!SARA_SYSTEM.includes('All 4s Bent Knee Lift'), 'old All 4s Bent Knee Lift name is gone')
assert(
  matchingRedFlags('All Fours Side Leg Lift hurts.').some((rule) => rule.id === 'movement-pain'),
  'All Fours Side Leg Lift still counts as pain',
)
assert(
  /hip replacement should avoid Side-lying bent knee lift, Side-lying straight leg circle, Butterfly, and All Fours Side Leg Lift/.test(
    SARA_SYSTEM,
  ),
  'hip-replacement avoid list keeps movements 3, 4, 5, and 9 under the new name',
)
assert(/plus the PfilAtes research facts/.test(SARA_SYSTEM), 'claims whitelist admits the research facts')
assert(knowledge.length < 4500, `research block stays within budget (${knowledge.length} chars)`)
for (const item of RESEARCH_FACTS) {
  assert(knowledge.includes(item.fact), `research fact in prompt: ${item.id}`)
  assert(item.source && knowledge.includes(item.source), `research fact cites a source: ${item.id}`)
}
const researchDoc = readFileSync(new URL('../docs/pfilates-research.md', import.meta.url), 'utf8')
for (const [label, needle] of [
  ['EMG range', '21% to +56%'],
  ['Bridge 56%', '56% (15-82)'],
  ['strength 33%', '33% (13.2 – 16.9 cm H2O, p=.006)'],
  ['Au leaks', '2.07 vs 0.94'],
  ['VESy expansion', 'Video, EMG, Synchronization'],
]) {
  assert(researchDoc.includes(needle), `research doc backs ${label}`)
}
for (const sample of RESEARCH_QA_CASES) {
  for (const needle of sample.mustMention) {
    assert(knowledge.includes(needle), `${sample.id}: prompt holds "${needle}"`)
  }
  assert(researchReplyIssues(sample.goodReply).length === 0, `${sample.id}: sourced reply passes`)
  assert(researchReplyIssues(sample.badReply).length > 0, `${sample.id}: overstated reply is caught`)
  assert(buildMessages(sample.prompt)[0].content === SARA_SYSTEM, `${sample.id}: no red-flag lead-in`)
}
const painResearch = "Bridging hurts, but the research says it's the strongest one. Should I keep going?"
assert(
  matchingRedFlags(painResearch).some((rule) => rule.id === 'movement-pain'),
  'pain + research question still triggers the pain rule',
)
assert(
  buildMessages(painResearch)[0].content.includes('If a movement at any time causes pain, stop that movement.'),
  'pain + research question leads with the stop rule',
)
assert(RESEARCH_ALLOWED_PERCENTS.includes('80%') && RESEARCH_ALLOWED_PERCENTS.includes('50%'), '80% and 50% are allowed percents')
assert(
  /80% of people who use the PfilAtes™ program \(or at least 50%\) improved in 28 days of training/.test(knowledge),
  '80% / 28 days result is in the research knowledge',
)
assert(
  /80% of people who use the PfilAtes™ program \(or at least 50%\) improved in 28 days of training/.test(SARA_SYSTEM),
  '80% / 28 days result is in the prompt',
)
assert(!SARA_SYSTEM.includes('showed 74% bladder symptom improvement'), 'old general 74% bladder claim is gone')
assert(
  researchReplyIssues('PfilAtes™ movements can be up to 10x a standard Kegel.').length === 0,
  'up to 10x a standard Kegel is allowed',
)
assert(
  researchReplyIssues(
    'PfilAtes™ movements can activate the pelvic floor up to 10 times more than a standard Kegel.',
  ).length === 0,
  'confirmed 10 times wording is allowed',
)
assert(
  researchReplyIssues('PfilAtes is 10x stronger than a Kegel.').length > 0,
  'unqualified 10x is caught',
)
assert(
  researchReplyIssues('It activates the pelvic floor 10 times stronger than a Kegel.').length > 0,
  'unqualified 10 times is caught',
)
assert(
  researchReplyIssues('Studies have proven it is up to 10x a standard Kegel.').some((issue) => /proven/i.test(issue)),
  'proven is still caught beside the allowed 10x phrase',
)
assert(
  researchReplyIssues('PfilAtes will cure leaks and is up to 10x a standard Kegel.').some((issue) => /cure/i.test(issue)),
  'cure is still caught beside the allowed 10x phrase',
)
assert(researchDoc.includes('All Fours Side Leg Lift'), 'research doc uses All Fours Side Leg Lift')
assert(!researchDoc.includes('All-4s side leg lift'), 'research doc drops All-4s side leg lift')
assert(!researchDoc.includes('All 4s Bent Knee Lift'), 'research doc drops All 4s Bent Knee Lift')
const seventyFourPromptProblems = seventyFourProblems(SARA_SYSTEM)
assert(
  seventyFourPromptProblems.length === 0,
  `prompt never presents 74% as a community-women result${seventyFourPromptProblems.length ? `: ${seventyFourPromptProblems[0]}` : ''}`,
)
const seventyFourKnowledgeProblems = seventyFourProblems(knowledge)
assert(
  seventyFourKnowledgeProblems.length === 0,
  `knowledge never presents 74% as a community-women result${seventyFourKnowledgeProblems.length ? `: ${seventyFourKnowledgeProblems[0]}` : ''}`,
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
    assert(body.model === 'grok-4.20-0309-non-reasoning', 'sends the non-reasoning model')
    assert(body.max_tokens === 600, 'keeps max_tokens at 600')
    assert(body.messages[0].content.includes('Never diagnose'), 'sends Sara system prompt')
    assert(
      body.messages[0].content.includes(
        '80% of people who use the PfilAtes™ program (or at least 50%) improved in 28 days of training',
      ),
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
