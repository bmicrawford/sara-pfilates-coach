/**
 * Dr. Bruce Crawford's approved Ask Sara guardrails.
 *
 * Edit clinical wording here only. `server/askGrok.mjs` composes
 * `saraGuardrailPrompt()` into the system prompt and, when the latest
 * user message matches a rule, asks Sara to lead with that instruction.
 */

export const APPROVED_CLAIMS = [
  'PfilAtes showed 74% bladder symptom improvement.',
  'It takes 10 minutes a day.',
  "The women's course is a $149 lifetime purchase.",
  'It was created by Dr. Bruce Crawford.',
]

export const PFILATES_MOVEMENTS = [
  'Lunge',
  'Squat',
  'Side-lying bent knee lift',
  'Side-lying straight leg circle',
  'Butterfly',
  'Bridging',
  'Corkscrew',
  'Hovering',
  'All-4s side leg lift',
  'Cat-Cow',
]

export const ESSENTIAL_PFILATES_MOVEMENTS = [
  'Lunge',
  'Butterfly',
  'Bridging',
  'Hovering',
  'Cat-Cow',
]

const HIP_REPLACEMENT_AVOID = [
  'Side-lying bent knee lift',
  'Side-lying straight leg circle',
  'Butterfly',
  'All-4s side leg lift',
]

const PREGNANCY_AVOID_AFTER_12_WEEKS = ['Butterfly', 'Bridging', 'Corkscrew']

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function flexibleName(name) {
  return escapeRegExp(name).replace(/-/g, '[- ]?')
}

function englishList(items) {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

const PAIN_RE = /\b(pain(?:ful)?|hurts?|hurting|aches?|aching|sore|soreness)\b/gi
const MOVEMENT_RE = new RegExp(
  `\\b(?:movements?|exercises?|squeezes?|kegels?|pfilates|${PFILATES_MOVEMENTS.map(flexibleName).join('|')})\\b`,
  'gi',
)
const WORSENING_RE = /\b(getting worse|get worse|gets worse|gotten worse|worsening|worsened|worse)\b/gi
const PELVIC_SYMPTOM_RE =
  /\b(incontinence|incontinent|leaks?|leaking|frequency|frequent|urgency|urgent|bulge|prolapse|painful intercourse|painful sex|sex hurts|intercourse hurts)\b/gi
const OSTEOPOROSIS_RE = /\bosteoporosis\b/gi
const HIP_REPLACEMENT_RE =
  /\b(hip replacement|replaced hip|hip (?:was |has been )?replaced|replaced (?:my |a |the )?hip)\b/gi
const PREGNANCY_RE = /\b(pregnant|pregnancy|gestational)\b/gi

function negatedAt(text, index) {
  const before = text.slice(Math.max(0, index - 40), index)
  return /\b(no|not|without|don't|dont|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|never|haven't|havent)\b/i.test(
    before,
  )
}

function affirmedIndexes(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  const indexes = []
  let match
  while ((match = re.exec(text)) !== null) {
    if (!negatedAt(text, match.index)) indexes.push(match.index)
    if (match[0].length === 0) re.lastIndex += 1
  }
  return indexes
}

function affirmed(text, pattern) {
  return affirmedIndexes(text, pattern).length > 0
}

function near(text, patternA, patternB, window) {
  const left = affirmedIndexes(text, patternA)
  const right = affirmedIndexes(text, patternB)
  return left.some((a) => right.some((b) => Math.abs(a - b) <= window))
}

function matchesMovementPain(text) {
  return near(text, PAIN_RE, MOVEMENT_RE, 60)
}

function matchesWorseningSymptoms(text) {
  return near(text, PELVIC_SYMPTOM_RE, WORSENING_RE, 80)
}

function matchesOsteoporosis(text) {
  return affirmed(text, OSTEOPOROSIS_RE)
}

function matchesHipReplacement(text) {
  return affirmed(text, HIP_REPLACEMENT_RE)
}

function matchesPregnancy(text) {
  return affirmed(text, PREGNANCY_RE)
}

export const RED_FLAG_RULES = [
  {
    id: 'movement-pain',
    instruction: 'If a movement at any time causes pain, stop that movement.',
    matches: matchesMovementPain,
  },
  {
    id: 'worsening-symptoms',
    instruction:
      'If pelvic floor symptoms such as incontinence, frequency, urgency, bulge, or painful intercourse are getting worse, stop all movements and see a medical provider for a pelvic floor evaluation.',
    matches: matchesWorseningSymptoms,
  },
  {
    id: 'osteoporosis',
    instruction: 'Those with osteoporosis should avoid Cat-Cow.',
    matches: matchesOsteoporosis,
  },
  {
    id: 'hip-replacement',
    instruction: `Those with a hip replacement should avoid ${englishList(HIP_REPLACEMENT_AVOID)}.`,
    matches: matchesHipReplacement,
  },
  {
    id: 'pregnancy',
    instruction: `Pregnant users should avoid ${englishList(PREGNANCY_AVOID_AFTER_12_WEEKS)} after 12 weeks gestational age.`,
    matches: matchesPregnancy,
  },
]

export const RED_FLAG_QA_CASES = [
  {
    id: 'movement-pain',
    ruleId: 'movement-pain',
    prompt: 'The lunge hurts when I do it.',
  },
  {
    id: 'worsening-symptoms',
    ruleId: 'worsening-symptoms',
    prompt: 'My incontinence and urgency are getting worse.',
  },
  {
    id: 'worsening-bulge',
    ruleId: 'worsening-symptoms',
    prompt: 'The bulge and painful intercourse are getting worse.',
  },
  {
    id: 'osteoporosis',
    ruleId: 'osteoporosis',
    prompt: 'I have osteoporosis. Is Cat-Cow okay?',
  },
  {
    id: 'hip-replacement',
    ruleId: 'hip-replacement',
    prompt: 'I had a hip replacement. Which moves should I skip?',
  },
  {
    id: 'pregnancy',
    ruleId: 'pregnancy',
    prompt: "I'm 16 weeks pregnant. Can I do Butterfly and Bridging?",
  },
  {
    id: 'pregnancy-before-12-weeks',
    ruleId: 'pregnancy',
    prompt: "I'm 8 weeks pregnant. Can I do Corkscrew?",
  },
]

export const RED_FLAG_QA_NON_MATCHES = [
  'How much water should I drink today?',
  'The lunge does not hurt.',
  "I don't have osteoporosis.",
  'I have a knee replacement. What should I avoid?',
  'Why did I leak when I sneezed?',
]

export function matchingRedFlags(message) {
  const text = String(message ?? '')
  return RED_FLAG_RULES.filter((rule) => rule.matches(text))
}

export function redFlagLeadIn(message) {
  const hits = matchingRedFlags(message)
  if (!hits.length) return ''
  const lines = hits.map((rule) => `- ${rule.instruction}`).join('\n')
  return `Red-flag lead-in: The latest user message matches an approved situation. Give each matching instruction first and clearly, in this wording, before any other coaching. Then continue kindly. Do not add other conditions or advice beyond these rules.\n${lines}`
}

export function saraGuardrailPrompt() {
  const claims = APPROVED_CLAIMS.map((claim) => `- ${claim}`).join('\n')
  const rules = RED_FLAG_RULES.map((rule) => `- ${rule.instruction}`).join('\n')
  return `Approved claims only. You may state only these facts about results, time, price, and who created PfilAtes. Do not invent statistics, studies, cure claims, or diagnoses. Do not strengthen or add to them.
${claims}
You coach and do not diagnose. When relevant, say you do not replace an evaluation by a medical provider.
You sit alongside the $149 Kajabi course and do not replace it. Point users to the course for movement instruction.

PfilAtes movements, names exact: ${englishList(PFILATES_MOVEMENTS)}.
The Essential PfilAtes Movements are ${englishList(ESSENTIAL_PFILATES_MOVEMENTS)}.
Do not invent step-by-step instructions for these movements. Refer users to the course.

Red-flag rules from Dr. Bruce Crawford. When a user mentions any of these situations, give the matching instruction first and clearly, in this wording, then continue kindly. Do not talk them into working through pain. Do not add other conditions or advice beyond these rules. The pregnancy limits apply only after 12 weeks gestational age.
${rules}`
}
