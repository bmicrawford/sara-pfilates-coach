/** Prospect-facing copy for the public demo pass. Paid screens keep their own lines. */

export const PROSPECT_ASK_GREETING = 'Ask me about PfilAtes™ and your pelvic floor.'

export const PROSPECT_AI = 'Sara is an AI coach, not a doctor.'

export const PROSPECT_CLAIM_TIME = 'It takes 10 minutes a day.'

export const PROSPECT_CLAIM_CREATOR = 'It was created by Dr. Bruce Crawford.'

export const PROSPECT_CLAIM_PRICE = "The women's course is a $149 lifetime purchase."

export const PROSPECT_CLAIM_RESULT =
  '80% of people who use the PfilAtes™ program (or at least 50%) improved in 28 days of training.'

export const PROSPECT_ALONGSIDE = 'That course stays on Kajabi. Sara sits alongside it.'

export const PROSPECT_NO_IDENTITY = 'This demo does not ask for your name or date of birth.'

export const PROSPECT_HOME_NOTE = [
  PROSPECT_AI,
  PROSPECT_CLAIM_TIME,
  PROSPECT_CLAIM_CREATOR,
  PROSPECT_CLAIM_PRICE,
  PROSPECT_ALONGSIDE,
  PROSPECT_CLAIM_RESULT,
].join(' ')

export const PROSPECT_WELCOME = `${PROSPECT_AI} ${PROSPECT_ASK_GREETING} ${PROSPECT_HOME_NOTE}`

export const PROSPECT_REDEEM_NOTE = `${PROSPECT_WELCOME} No email on this demo.`

export const PROSPECT_ASK_SUB = `${PROSPECT_AI} ${PROSPECT_CLAIM_PRICE} ${PROSPECT_ALONGSIDE}`

export const PROSPECT_ASK_EMPTY =
  'Try “what is PfilAtes™?”, “what does 10 minutes a day look like?”, or “where does the $149 course live?”'

export const PAID_ASK_EMPTY =
  'Try “how much water?”, “why did I leak when I sneezed?”, or “what are symptoms of a UTI?”'

const PAID_ASK_SUB = 'I\u2019m listening \u2014 ask the real question.'

export function redeemAsksForEmail(demo: boolean): boolean {
  return !demo
}

export function promptsForNameOrDob(demo: boolean): boolean {
  return !demo
}

export function askIntro(
  demo: boolean,
  live: boolean,
  listening: boolean,
): { title: string; sub: string } {
  if (live) return { title: "I'm with you.", sub: 'Sara is talking.' }
  if (demo) return { title: PROSPECT_ASK_GREETING, sub: PROSPECT_ASK_SUB }
  return {
    title: listening ? "I'm listening." : "Hey — it's Sara.",
    sub: PAID_ASK_SUB,
  }
}

export function askEmptyHint(demo: boolean): string {
  return demo ? PROSPECT_ASK_EMPTY : PAID_ASK_EMPTY
}

export function homeIntro(demo: boolean): { greeting: string; note: string | null } {
  if (!demo) return { greeting: '', note: null }
  return { greeting: PROSPECT_ASK_GREETING, note: PROSPECT_HOME_NOTE }
}
