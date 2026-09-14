import { classifyAsk, replyAsSara } from './replies.ts'

const cases: { q: string; intent: ReturnType<typeof classifyAsk>; must: RegExp; mustNot: RegExp }[] = [
  {
    q: 'how much water?',
    intent: 'water_amount',
    must: /steady sips|smaller glasses|no single magic number/i,
    mustNot: /little sips count|i'm here\. tell me/i,
  },
  {
    q: 'why did I leak when I sneezed?',
    intent: 'leak_sneeze',
    must: /sneeze|timing|downward push/i,
    mustNot: /i'm here\. tell me|little sips/i,
  },
  {
    q: 'is coffee ok?',
    intent: 'coffee',
    must: /coffee|decaf|not a ban/i,
    mustNot: /little sips count|i'm here\. tell me/i,
  },
  {
    q: 'I leaked on a walk',
    intent: 'leak_activity',
    must: /walk|impact/i,
    mustNot: /short set you actually did|i'm here\. tell me/i,
  },
  {
    q: 'I did ten minutes',
    intent: 'exercise_done',
    must: /counts|log/i,
    mustNot: /i'm here\. tell me|sneeze/i,
  },
  {
    q: 'I already did 4 sessions today',
    intent: 'exercise_count',
    must: /three focused sessions|plenty|rest/i,
    mustNot: /i'm here\. tell me/i,
  },
  {
    q: 'new pelvic pain when I squeeze',
    intent: 'pain',
    must: /stop sign|clinician|pause/i,
    mustNot: /i'm here\. tell me|that's the good stuff/i,
  },
  {
    q: 'I feel a heaviness like a bulge',
    intent: 'prolapse',
    must: /heaviness|clinician/i,
    mustNot: /i'm here\. tell me/i,
  },
  {
    q: 'how do I move Sara to a new phone?',
    intent: 'phone',
    must: /\/move|new phone|redeem/i,
    mustNot: /i'm here\. tell me/i,
  },
  {
    q: 'idk',
    intent: 'unclear',
    must: /are you asking about/i,
    mustNot: /i'm here\. tell me what's on your mind/i,
  },
  {
    q: 'what are symptoms of a UTI?',
    intent: 'uti',
    must: /uti|burning or stinging|urine test|clinician/i,
    mustNot: /you have a uti|little sips count|an urge is a signal/i,
  },
  {
    q: 'I have burning when I pee',
    intent: 'uti',
    must: /burning or stinging|pause pelvic-floor|clinician/i,
    mustNot: /you have a uti|that counts|stop sign/i,
  },
  {
    q: 'do I have a UTI?',
    intent: 'uti',
    must: /can't tell you whether this is a uti|urine check|urgent care/i,
    mustNot: /you have a uti|an urge is a signal/i,
  },
  {
    q: 'cloudy urine and it smells foul',
    intent: 'uti',
    must: /cloudy|smells off|clinician/i,
    mustNot: /you have a uti/i,
  },
]

let failed = 0
for (const c of cases) {
  const intent = classifyAsk(c.q)
  const reply = replyAsSara(c.q)
  const okIntent = intent === c.intent
  const okMust = c.must.test(reply)
  const okNot = !c.mustNot.test(reply)
  const banned = /\bstress\b/i.test(reply)
  if (!okIntent || !okMust || !okNot || banned) {
    failed += 1
    console.error('FAIL', { q: c.q, intent, expected: c.intent, reply, okIntent, okMust, okNot, banned })
  } else {
    console.log(`OK  ${c.q}\n    → ${reply}\n`)
  }
}

if (failed) {
  console.error(`${failed} case(s) failed`)
  process.exit(1)
}
console.log(`All ${cases.length} smoke cases passed`)
