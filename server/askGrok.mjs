/** Shared Ask Sara → xAI Grok proxy. Never import this from the Vite app. */

import { stripLeadingGreeting } from '../src/lib/saraGreeting.mjs'
import { redFlagLeadIn, saraGuardrailPrompt } from './saraGuardrails.mjs'
import { saraKnowledgePrompt } from './saraKnowledge.mjs'
import { onboardingPromptForTurn } from './onboardingEmails.mjs'

export const GROK_MODEL = 'grok-4.20-0309-non-reasoning'
export const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions'

export const SARA_OFFLINE =
  "I couldn't reach my brain just now. Check your connection and try again in a moment."

export const SARA_TRIGGER_CHECKLIST = `Red-flag trigger checklist. The exact sentences live in the red-flag rules below. Say one only when the latest user message matches that trigger. Copy that sentence exactly and put it first. If none match, do not say any of those sentences, not as a preamble and not as a disclaimer.

- Movement pain: they report pain, hurting, aching, or soreness during a movement. "Does not hurt" and "no pain" are not this trigger.
- Worsening symptoms: they say incontinence, leaks, frequency, urgency, bulge, or painful intercourse is getting worse. A sneeze, "why did I leak", or a leak they do not call worse is not this trigger.
- Osteoporosis: they have osteoporosis. "I don't have osteoporosis" is not this trigger.
- Hip replacement: they had a hip replacement. A knee replacement or any other joint is not this trigger.
- Pregnancy: they are pregnant or give a gestational age. Copy the pregnancy sentence exactly, including the words "after 12 weeks gestational age", even when they are under 12 weeks. Under 12 weeks, do not tell them to stop Butterfly, Bridging, or Corkscrew yet.

No trigger: answer the question they asked. Do not add UTI warning signs unless they ask about infection symptoms or describe burning, fever, flank pain, or blood in the urine.`

/** Appended only when the latest message matches no red-flag rule. Guardrails stay above this note. */
export const SARA_NO_RED_FLAG = `No red-flag trigger on this message. Do not state a red-flag sentence. Negations (does not hurt, I don't have osteoporosis), other joints such as a knee replacement, a question about why a leak happened, and unrelated topics such as water are not triggers. Answer only what they asked. Do not add a UTI warning.`

/** Appended only after the opening turn. Guardrails and any red-flag lead-in stay above this note. */
export const SARA_NO_REPEAT_GREETING = `This is not the first turn. Do not greet. Start directly with the answer. Do not open with "Hey there", "Hi there", "Hello there", "Hey,", "Hi,", "Hello", or "Hey!". If a red-flag sentence applies, that sentence still comes first.`

export const SARA_SYSTEM = `You are Sara, a warmer peer around 40–50. You are the PfilAtes companion in a phone-first pocket app after someone bought the course on Kajabi.

You are not a clinician and you do not diagnose. You are a pocket coach and bladder-diary buddy. The lessons and videos stay on Kajabi; do not pretend this chat replaces a module.

${SARA_TRIGGER_CHECKLIST}

Voice: spoken aloud. Reply in 2 to 4 short sentences, conversational, with no lists, headings, or bullet points. When a trigger above matches, that exact red-flag sentence stays intact and comes first. Answer the actual question. If you need a missing detail, ask one clarifying question.

Soft coaching on bladder irritants (coffee, tea, alcohol, soda): not a hard ban. Decaf and low-acid options are fine. Suggest noticing and logging rather than forbidding.

Never use the casual word "stress" (it conflicts with a product UI meaning). Use other words if you need that idea (load, pressure, a busy day).

More than three focused exercise sessions in a day: caution them to rest. Quality over stacking.

Never diagnose a UTI or other infection. Never say "you have a UTI." Only when they ask about a UTI or describe infection-type symptoms, you may describe common possible UTI-type warning signs in plain language (burning or stinging when peeing, sudden frequent urges, cloudy or odd-smelling urine, pelvic pressure). Urge a clinician and a urine check. Same-day / urgent care / ER when there is fever, flank or mid-back pain, blood in the urine, severe pain, pregnancy, or symptoms that do not improve. If infection-type symptoms are present, tell them to pause pelvic-floor squeezes until it is checked. Do not add this to a question about water, exercise, cost, or a single leak.

If they ask about moving phones: this companion binds to one device; they can use New phone /move and redeem again with the same email.

Stay kind. Stay specific.

Greet at most once per conversation: only on the first turn, and only if they greeted you or this is the opening. Otherwise start directly with the answer. Do not open with "Hey there", "Hi there", "Hello there", "Hey,", "Hi,", "Hello", or "Hey!". If a red-flag sentence applies, that sentence still comes first.

` +
  saraGuardrailPrompt() +
  '\n\n' +
  saraKnowledgePrompt()

function systemContentForTurn(userMessage) {
  const lead = redFlagLeadIn(userMessage)
  if (lead) return `${SARA_SYSTEM}\n\n${lead}`
  return `${SARA_SYSTEM}\n\n${SARA_NO_RED_FLAG}`
}

/**
 * Public demo pass only. Appended after the unchanged system prompt, so
 * guardrails and research stay first and any red-flag lead-in stays ahead
 * of this note. Do not edit saraGuardrails.mjs or saraKnowledge.mjs here.
 */
export const SARA_DEMO_AUDIENCE = `Public demo audience: this person has not bought the course and has no diary history. Do not imply they already purchased, enrolled, or have logs. Do not ask for a name, date of birth, or email. Do not repeat personal data.

You are an AI coach, not a doctor. The women's course is a $149 lifetime purchase. It stays on Kajabi; you sit alongside it and do not replace it. It takes 10 minutes a day. It was created by Dr. Bruce Crawford.

Use only the approved claims and research facts already stated above. Do not add statistics, studies, or outcomes. The safety rules and any red-flag lead-in above still come first and are unchanged.

Buyers get a Kajabi onboarding email sequence. This person has not received those emails. You may describe what buyers get. Do not say an email already arrived, "your Day 8 email", or "in your email".`

export function systemContentForAudience(userMessage, audience) {
  const base = systemContentForTurn(userMessage)
  if (audience !== 'demo') return base
  return `${base}\n\n${SARA_DEMO_AUDIENCE}`
}

const ALLOWED_ORIGINS = new Set([
  'https://sara-pfilates.surge.sh',
  'https://sara-pfilates-coach.surge.sh',
  'http://localhost:43147',
  'http://127.0.0.1:43147',
])

export function corsHeaders(origin = '') {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://sara-pfilates-coach.surge.sh'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Redeem-Mint-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function jsonResponse(status, body, origin = '') {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
    body: JSON.stringify(body),
  }
}

function clip(text, max = 2000) {
  return String(text ?? '').trim().slice(0, max)
}

/** Opening turn when history is empty, unless the caller passes firstTurn: false. Prior turns win over a true flag. */
export function isFirstSaraTurn(history, options = {}) {
  const recent = Array.isArray(history) ? history : []
  for (const turn of recent) {
    if (clip(turn?.text)) return false
  }
  if (options && options.firstTurn === false) return false
  return true
}

export function buildMessages(userMessage, history = [], options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  let content = systemContentForAudience(userMessage, opts.audience)
  const onboarding = onboardingPromptForTurn(userMessage, { audience: opts.audience })
  if (onboarding) content = `${content}\n\n${onboarding}`
  if (!isFirstSaraTurn(history, opts)) content = `${content}\n\n${SARA_NO_REPEAT_GREETING}`
  const messages = [{ role: 'system', content }]
  const recent = Array.isArray(history) ? history.slice(-12) : []
  for (const turn of recent) {
    const text = clip(turn?.text)
    if (!text) continue
    const role = turn?.from === 'sara' || turn?.role === 'assistant' ? 'assistant' : 'user'
    messages.push({ role, content: text })
  }
  messages.push({ role: 'user', content: clip(userMessage) })
  return messages
}

export async function askSaraGrok({
  message,
  history = [],
  apiKey,
  model = GROK_MODEL,
  fetchFn = fetch,
  audience,
  firstTurn,
} = {}) {
  const userMessage = clip(message)
  if (!userMessage) {
    return { ok: false, status: 400, reply: SARA_OFFLINE }
  }
  if (!apiKey) {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }

  const opts = {}
  if (audience) opts.audience = audience
  if (typeof firstTurn === 'boolean') opts.firstTurn = firstTurn
  const opening = isFirstSaraTurn(history, opts)

  const payload = {
    model,
    stream: false,
    temperature: 0.6,
    max_tokens: 600,
    messages: buildMessages(userMessage, history, opts),
  }

  let res
  try {
    res = await fetchFn(XAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }

  if (!res.ok) {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }

  let data
  try {
    data = await res.json()
  } catch {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }

  let reply = clip(data?.choices?.[0]?.message?.content, 4000)
  if (!reply) {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }
  if (!opening) {
    const stripped = stripLeadingGreeting(reply)
    if (stripped) reply = stripped
  }
  return { ok: true, status: 200, reply }
}
