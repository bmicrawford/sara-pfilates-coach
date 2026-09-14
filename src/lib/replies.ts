export type AskIntent =
  | 'water_amount'
  | 'water_timing'
  | 'coffee'
  | 'tea'
  | 'alcohol'
  | 'soda'
  | 'irritants'
  | 'leak_sneeze'
  | 'leak_activity'
  | 'leak_general'
  | 'pad'
  | 'void_urge'
  | 'void_frequency'
  | 'exercise_form'
  | 'exercise_count'
  | 'exercise_done'
  | 'diary'
  | 'prolapse'
  | 'pain'
  | 'night'
  | 'phone'
  | 'course'
  | 'greeting'
  | 'unclear'

export type ChatTurn = { from: 'you' | 'sara'; text: string }

type Rule = {
  intent: AskIntent
  weight: number
  test: (q: string) => boolean
}

const RULES: Rule[] = [
  {
    intent: 'pain',
    weight: 12,
    test: (q) =>
      /\bpain\b|\bache\b|\bsore\b|\bhurts?\b|\bsharp\b|\bburning\b/.test(q) &&
      /pelvic|pelvis|vagina|perineum|tailbone|squeeze|kegel|exercis|pfil|worse|worsen|new |started|when i/.test(
        q,
      ),
  },
  {
    intent: 'pain',
    weight: 11,
    test: (q) => /new (or )?worsen|getting worse|pain (got|is) worse|stop if/.test(q),
  },
  {
    intent: 'water_amount',
    weight: 10,
    test: (q) =>
      /how much water|how much (should|do) i (drink|have)|water (goal|target|amount|intake)|too much water|not enough water|glasses? of water|\d+\s?(oz|ml|lit)/.test(
        q,
      ),
  },
  {
    intent: 'water_timing',
    weight: 8,
    test: (q) =>
      /when (to |should i )?drink|last (sip|drink|glass)|evening water|water (at )?night|stop drinking before/.test(
        q,
      ),
  },
  {
    intent: 'coffee',
    weight: 10,
    test: (q) => /\bcoffe|\bcaffein|\bespresso|\blatte|\bdecaf|\bamericano/.test(q),
  },
  {
    intent: 'tea',
    weight: 9,
    test: (q) => /\btea\b|\bchai\b|\bmatcha\b/.test(q),
  },
  {
    intent: 'alcohol',
    weight: 9,
    test: (q) => /\balcohol|\bwine\b|\bbeer\b|\bprosecco|\bcocktail|\bdrink(ing)? (tonight|out)/.test(q),
  },
  {
    intent: 'soda',
    weight: 9,
    test: (q) => /\bsoda\b|\bpop\b|\bcola\b|\bfizzy|\bsparkling|\bcarbonat|\bdiet coke|\bpepsi/.test(q),
  },
  {
    intent: 'irritants',
    weight: 7,
    test: (q) => /irritant|triggers? my bladder|bladder (hate|trigger)|acidic drink/.test(q),
  },
  {
    intent: 'leak_sneeze',
    weight: 11,
    test: (q) =>
      /(leak|wet|accident|dribbl).{0,24}(sneez|cough|laugh|lift)|((sneez|cough|laugh|lift).{0,24}(leak|wet|accident|dribbl))/.test(
        q,
      ),
  },
  {
    intent: 'leak_activity',
    weight: 9,
    test: (q) =>
      /(leak|wet|dribbl).{0,20}(walk|run|jump|workout|class|exercis)|(walk|run|jump|workout).{0,20}(leak|wet)/.test(
        q,
      ),
  },
  {
    intent: 'leak_general',
    weight: 6,
    test: (q) => /\bleak|\bdamp\b|\bdribbl|\baccident\b|\bwet myself|\bwetness/.test(q),
  },
  {
    intent: 'pad',
    weight: 8,
    test: (q) => /\bpad\b|\bliner\b|\bunderwear change|change (my )?pad/.test(q),
  },
  {
    intent: 'void_frequency',
    weight: 9,
    test: (q) =>
      /how often.{0,12}(pee|void|urinat|bathroom)|every \d+ min|(pee|void|go) (too )?often|12 times|always (need|have) to (pee|go)/.test(
        q,
      ),
  },
  {
    intent: 'void_urge',
    weight: 7,
    test: (q) => /\burge\b|\bvoid\b|\bpee\b|\bwees?\b|\bbathroom|\btoilet|\burinat/.test(q),
  },
  {
    intent: 'exercise_count',
    weight: 10,
    test: (q) =>
      /how many (sessions?|sets?|times)|(\d+|three|four|five) (sessions?|sets?|times)|more than three|too many sessions|do (it )?again today/.test(
        q,
      ),
  },
  {
    intent: 'exercise_form',
    weight: 8,
    test: (q) =>
      /how (do|to) (i )?(the )?(squeeze|kegel|lift|exercis)|form|am i doing (it|this) (right|wrong)|where (should|do) i feel/.test(
        q,
      ),
  },
  {
    intent: 'exercise_done',
    weight: 8,
    test: (q) =>
      /(i )?(just )?(did|finished|completed|logged).{0,20}(\d+\s*)?(min|minute|session|set|class)|did ten|ten minutes|pfil/.test(
        q,
      ),
  },
  {
    intent: 'exercise_done',
    weight: 5,
    test: (q) => /\bexercis|\bkegel|\bsqueeze|\bworkout|\bstretch\b/.test(q),
  },
  {
    intent: 'diary',
    weight: 8,
    test: (q) =>
      /why (do i )?log|what (do i )?track|diary|bladder diary|what (should|do) i (write|note)/.test(q),
  },
  {
    intent: 'prolapse',
    weight: 10,
    test: (q) => /\bprolapse|\bheaviness|\bbulge|\bheavy (feeling|down there)|something coming down/.test(q),
  },
  {
    intent: 'night',
    weight: 7,
    test: (q) => /\bnight\b|\bovernight|\bbed\b|\bsleep\b|\bnocturia|up to pee/.test(q),
  },
  {
    intent: 'phone',
    weight: 9,
    test: (q) => /new phone|other phone|move (sara |this )?(to )?(a )?new|switch(ed)? phone|lost my phone|different device/.test(q),
  },
  {
    intent: 'course',
    weight: 6,
    test: (q) => /\bkajabi|\bcourse\b|\blessons?\b|\bmodule|\bvideo/.test(q),
  },
  {
    intent: 'greeting',
    weight: 5,
    test: (q) => /^(hi|hey|hello|thanks|thank you|ok|okay|good morning|good night)[.!\s]*$/.test(q),
  },
]

const SHORT_FOLLOWUP: Record<string, AskIntent> = {
  leak: 'leak_general',
  leaks: 'leak_general',
  drink: 'water_amount',
  drinks: 'water_amount',
  water: 'water_amount',
  coffee: 'coffee',
  tea: 'tea',
  pad: 'pad',
  pads: 'pad',
  exercise: 'exercise_form',
  session: 'exercise_done',
  pain: 'pain',
  phone: 'phone',
  urge: 'void_urge',
  void: 'void_urge',
}

export function classifyAsk(prompt: string, recent: ChatTurn[] = []): AskIntent {
  const q = normalize(prompt)
  if (!q) return 'unclear'

  const lastSara = [...recent].reverse().find((m) => m.from === 'sara')
  if (lastSara && /are you asking about|which piece|tell me which/i.test(lastSara.text)) {
    const hit = SHORT_FOLLOWUP[q.replace(/[?.!]/g, '').trim()]
    if (hit) return hit
  }

  const scores = new Map<AskIntent, number>()
  for (const rule of RULES) {
    if (rule.test(q)) {
      scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight)
    }
  }

  let best: AskIntent = 'unclear'
  let bestScore = 0
  for (const [intent, score] of scores) {
    if (score > bestScore) {
      best = intent
      bestScore = score
    }
  }

  if (bestScore < 5) return 'unclear'
  return best
}

export function replyAsSara(prompt: string, recent: ChatTurn[] = []): string {
  const q = normalize(prompt)
  const intent = classifyAsk(prompt, recent)
  return render(intent, q)
}

export function askShouldCelebrate(prompt: string, recent: ChatTurn[] = []): boolean {
  return classifyAsk(prompt, recent) === 'exercise_done'
}

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, ' ').trim()
}

function todayExerciseCount(): number {
  try {
    const raw = localStorage.getItem('sara.logs')
    if (!raw) return 0
    const logs = JSON.parse(raw) as { kind?: string; at?: string }[]
    const now = new Date()
    return logs.filter((l) => {
      if (l.kind !== 'exercise' || !l.at) return false
      const d = new Date(l.at)
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      )
    }).length
  } catch {
    return 0
  }
}

function mentionedSessionCount(q: string): number | null {
  const digit = q.match(/(\d+)\s*(sessions?|sets?|times)/)
  if (digit) return Number(digit[1])
  if (/\bfour\b|\bfive\b/.test(q)) return 4
  if (/\bthree\b/.test(q)) return 3
  return null
}

function render(intent: AskIntent, q: string): string {
  switch (intent) {
    case 'water_amount':
      return "There's no single magic number. Steady sips through the day usually treat the bladder more kindly than one huge bottle. If you're thirsty, drink. If leaks jump after a big dump of water, try smaller glasses and log them so you can see your own pattern."

    case 'water_timing':
      return "Front-load sips earlier if nights are noisy. A last modest glass with dinner — not a pint at the sink before bed — is enough for most people. Log evening drinks if you're curious; the diary will tell you more than a rule will."

    case 'coffee':
      return "Coffee can wake the bladder up for some people — that's information, not a ban. Keep it if you love it: smaller cup, sip it, or try decaf / low-acid and notice the next couple of hours. Log the cup so you can see whether it's your trigger or just a coincidence."

    case 'tea':
      return "Tea is usually gentler than coffee, especially herbal or decaf. Regular black tea still has caffeine, so if urges follow a mug, try a weaker brew or herbal and compare. Not a hard no — just a soft experiment you can log."

    case 'alcohol':
      return "Alcohol can make the bladder more chatty and sleep more broken. That's coaching, not a lecture. If you're going to have a glass, sip water alongside and maybe skip a late second one. Log it if you want to see the next morning clearly."

    case 'soda':
      return "Fizz and many sodas can nudge urgency — caffeine and bubbles both play a part. You don't have to quit forever. Try a smaller can, a flat drink, or a low-acid mixer and see how the next hour feels. The log is better than guessing."

    case 'irritants':
      return "Common bladder nudges: coffee, strong tea, soda, alcohol, and very acidic sips. None of those are a forever ban. Change one thing at a time, keep the rest of the day ordinary, and log drinks plus urges. Your pattern matters more than a list on the internet."

    case 'leak_sneeze':
      return "A sneeze (or cough, laugh, lift) is a sudden downward push. A leak then is a timing thing — the pelvic floor didn't meet the pressure in time — not a character flaw. When you can see it coming, a gentle squeeze first is the move we practice in the course. Log the sneeze so the pattern is visible."

    case 'leak_activity':
      return "Leaking on a walk or during a class is common when the floor is working against impact or a long hold. It doesn't mean you should stop moving. Note what you were doing, how long, and whether you had a chance to squeeze first. That's useful data — and the Kajabi lessons stay there for the longer practice."

    case 'leak_general':
      return "A leak is a fact, not a verdict. Write the time and what was going on — sneeze, walk, urge, nothing obvious. Patterns are kinder than guessing. If it's new, heavier, or coming with pelvic pain, pause the extra work and talk to a clinician."

    case 'pad':
      return "Pads are a tool, not a score. This companion only needs time and a reason — routine, damp, overnight, heading out. Change when you want to feel fresh. If you're changing constantly, log those times; that's the story, not the brand of pad."

    case 'void_frequency':
      return "Going very often can be habit, a small bladder window, or a day of extra sips. Don't start holding to 'train' it on your own. Log voids for a day or two and notice the gaps. If it's sudden, painful, or you see blood, that's clinician territory — I'm only the diary."

    case 'void_urge':
      return "An urge is a signal, not an emergency every time. One easy breath, a gentle lift if that helps, then decide: bathroom or wait a minute. Log the urge either way. If you're leaking on the way, note that too — it changes what we look at."

    case 'exercise_form':
      return "Think lift-and-let-go, not brace-and-bear-down. You should feel a gentle inward lift, then a full release. If you hold your breath, clench your bum, or feel bearing down, ease off and use a smaller effort. The course videos on Kajabi show the form; here we just keep it honest and short."

    case 'exercise_count': {
      const said = mentionedSessionCount(q)
      const logged = todayExerciseCount()
      const n = said ?? logged
      if (n > 3 || /more than three|too many/.test(q)) {
        return "Three focused sessions in a day is plenty. More than that and the muscles can get tired and cranky — quality over stacking. Rest them and pick it up tomorrow. If something already feels overworked, stop."
      }
      return "A little most days beats a marathon. One or two honest sessions is a solid day; three is the ceiling I'd stay under. If you've already logged a few, you're done — go live your day."
    }

    case 'exercise_done': {
      const logged = todayExerciseCount()
      if (logged >= 3 || (mentionedSessionCount(q) ?? 0) > 3) {
        return "That's a full day of work. I wouldn't stack another session — let the muscles recover. If you haven't logged the last one, pop it in so we can cheer the right number, then rest."
      }
      return "That counts. A set you actually did is the whole point. Log it on Home if you haven't — especially the minutes and how it felt — and we can keep the day honest without adding extra work."
    }

    case 'diary':
      return "The diary is just breadcrumbs: time, what you drank, a void or leak, a pad change, a session. Not a novel. We use it to spot 'this drink, then that urge' instead of blaming yourself. Log the boring stuff; that's where the pattern hides."

    case 'prolapse':
      return "Heaviness or a bulge-y feeling is worth taking seriously and worth not panicking over. Ease off long standing, skip bearing down, and use the course's pacing rather than extra squeezes. If it's new, worsening, or you can see or feel tissue where it wasn't, get a clinician who knows pelvic floor — I'm a companion, not a diagnosis."

    case 'pain':
      return "New or worsening pelvic pain is a stop sign. Pause the exercises, don't push through a squeeze, and check in with a clinician who knows pelvic floor. Log what you were doing when it started if that helps you explain it. I'm here for the diary — not to talk you into working through pain."

    case 'night':
      return "Nights can feel louder: one more void, a pad change, a sip you wish you'd had earlier. Keep the last drink modest, skip scorekeeping, and log overnight trips if you want. Tomorrow is another gentle try — the course stays on Kajabi if you need the longer night lesson."

    case 'phone':
      return "Sara stays bound to one phone so it feels private. If this is a new one, use New phone on Home (or /move): enter the email you redeemed with, release the old bind, then redeem again here. Nothing flashy — just a hand-off."

    case 'course':
      return "The lessons and videos stay on Kajabi. This pocket app is the diary and a quick check-in — it doesn't replace a module. If you're lost in a lesson, finish that video first; then come back and log what you practiced."

    case 'greeting':
      return "Hey. I'm here. Ask me a real one — how much water, a sneeze-leak, coffee, a session count, or something that doesn't feel right."

    case 'unclear':
      return "I want to answer the actual thing, not a vague pep talk. Are you asking about a drink, a leak, a session, a pad, or something that doesn't feel right?"
  }
}
