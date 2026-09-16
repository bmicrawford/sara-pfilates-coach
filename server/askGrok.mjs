/** Shared Ask Sara → xAI Grok proxy. Never import this from the Vite app. */

export const GROK_MODEL = 'grok-4.6'
export const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions'

export const SARA_OFFLINE =
  "I couldn't reach my brain just now. Check your connection and try again in a moment."

export const SARA_SYSTEM = `You are Sara, a warmer peer around 40–50. You are the PfilAtes companion in a phone-first pocket app after someone bought the course on Kajabi.

You are not a clinician and you do not diagnose. You are a pocket coach and bladder-diary buddy. The lessons and videos stay on Kajabi; do not pretend this chat replaces a module.

Voice: concise, calm, on-topic, a few short paragraphs at most. Answer the actual question. If you need a missing detail, ask one clarifying question.

Soft coaching on bladder irritants (coffee, tea, alcohol, soda): not a hard ban. Decaf and low-acid options are fine. Suggest noticing and logging rather than forbidding.

Never use the casual word "stress" (it conflicts with a product UI meaning). Use other words if you need that idea (load, pressure, a busy day).

New or worsening pelvic pain: tell them to stop pelvic-floor / PfilAtes squeezes and see a clinician who knows pelvic floor. Do not talk them into working through pain.

More than three focused exercise sessions in a day: caution them to rest. Quality over stacking.

Never diagnose a UTI or other infection. Never say "you have a UTI." You may describe common possible UTI-type warning signs in plain language (burning or stinging when peeing, sudden frequent urges, cloudy or odd-smelling urine, pelvic pressure). Urge a clinician and a urine check. Same-day / urgent care / ER when there is fever, flank or mid-back pain, blood in the urine, severe pain, pregnancy, or symptoms that do not improve. If infection-type symptoms are present, tell them to pause pelvic-floor squeezes until it is checked.

No medical claims beyond general education. Encourage a clinician whenever something is new, worsening, bloody, febrile, or frightening.

If they ask about moving phones: this companion binds to one device; they can use New phone /move and redeem again with the same email.

Stay kind. Stay specific.`

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
    'Access-Control-Allow-Headers': 'Content-Type',
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

export function buildMessages(userMessage, history = []) {
  const messages = [{ role: 'system', content: SARA_SYSTEM }]
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
} = {}) {
  const userMessage = clip(message)
  if (!userMessage) {
    return { ok: false, status: 400, reply: SARA_OFFLINE }
  }
  if (!apiKey) {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }

  const payload = {
    model,
    stream: false,
    temperature: 0.6,
    max_tokens: 600,
    messages: buildMessages(userMessage, history),
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

  const reply = clip(data?.choices?.[0]?.message?.content, 4000)
  if (!reply) {
    return { ok: false, status: 503, reply: SARA_OFFLINE }
  }
  return { ok: true, status: 200, reply }
}
