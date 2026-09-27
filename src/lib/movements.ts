/**
 * Movement Selection Worksheet catalogs.
 *
 * The printed sheet is the source of the names, order, and three questions.
 * Catalogs are data so another list can be added later — for example the
 * 7-movement prolapse sheet, which drops Lunge, Squat, and Cat & Cow.
 * This app ships only the standard 10-movement worksheet. No other catalog
 * is offered in the UI.
 */

export type YesNo = 'yes' | 'no'
export type ContractionRating = 0 | 1 | 2 | 3

export type MovementDefinition = {
  id: string
  name: string
}

export type MovementCatalog = {
  id: string
  title: string
  movements: readonly MovementDefinition[]
}

export type MovementAnswers = {
  movementId: string
  /** "Does This Movement Cause Pain?" Yes eliminates the movement. */
  pain: YesNo
  /** "Is This A Movement You Could Perform Regularly?" No eliminates the movement. */
  regular: YesNo
  contraction: ContractionRating
}

export type SelectionResult = {
  status: 'plan' | 'empty'
  /** Set when status is empty. */
  reason?: 'all-eliminated' | 'all-zero'
  /** Non-eliminated ids, highest contraction first. Ties keep worksheet order. */
  rankedIds: string[]
  /** Up to 3 ids Sara suggests. Empty when no plan is possible. */
  suggestedIds: string[]
}

export const WORKSHEET_TITLE = 'Movement Selection Worksheet'

export const WORKSHEET_INTRO =
  "Fill this out after you've learned the movements in the PfilAtes course."

export const PAIN_QUESTION = 'Does This Movement Cause Pain?'
export const REGULAR_QUESTION = 'Is This A Movement You Could Perform Regularly?'
export const CONTRACTION_QUESTION = 'Feeling of Pelvic Floor Contraction'
export const CIRCLE_ANSWERS = 'Circle your answers'

export const CONTRACTION_SCALE: readonly { value: ContractionRating; label: string }[] = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Strong' },
]

export const TOP_MOVEMENTS_TITLE = 'My top movements'
export const COURSE_LINE = 'As taught in your PfilAtes course.'

export const NO_EVERYDAY_PLAN_MESSAGE =
  'None of these movements are ready for an everyday plan. Review the movements in the PfilAtes course, and check with your clinician or pelvic floor PT.'

export const RESTART_CUE =
  "A missed day is just a missed day. Start again with today's movements whenever you're ready."

/** Names and order match the printed Movement Selection Worksheet. */
export const STANDARD_MOVEMENT_CATALOG: MovementCatalog = {
  id: 'standard',
  title: WORKSHEET_TITLE,
  movements: [
    { id: 'lunge', name: 'Lunge' },
    { id: 'squat', name: 'Squat' },
    { id: 'side-lying-bent-knee-lift', name: 'Side-Lying Bent Knee Lift' },
    { id: 'side-lying-straight-leg-circles', name: 'Side-Lying Straight-Leg Circles' },
    { id: 'butterfly', name: 'Butterfly' },
    { id: 'bridge', name: 'Bridge' },
    { id: 'corkscrew', name: 'Corkscrew' },
    { id: 'hovering', name: 'Hovering' },
    { id: 'all-4s', name: 'All 4s' },
    { id: 'cat-cow', name: 'Cat & Cow' },
  ],
}

/**
 * Shipped catalogs. Add a future variant as another entry. The UI reads
 * `STANDARD_MOVEMENT_CATALOG` only.
 */
export const MOVEMENT_CATALOGS: Readonly<Record<string, MovementCatalog>> = {
  standard: STANDARD_MOVEMENT_CATALOG,
}

export function movementName(id: string, catalog: MovementCatalog = STANDARD_MOVEMENT_CATALOG): string {
  return catalog.movements.find((movement) => movement.id === id)?.name ?? id
}

/** Yes on pain, or No on "could perform regularly", drops the movement. */
export function isEliminated(answer: Pick<MovementAnswers, 'pain' | 'regular'>): boolean {
  return answer.pain === 'yes' || answer.regular === 'no'
}

/**
 * Among movements that were not eliminated, suggest the top 3 by contraction
 * rating. Equal ratings keep worksheet order. If every movement is eliminated,
 * or every remaining movement is rated 0, there is no plan.
 */
export function selectTopMovements(
  catalog: MovementCatalog,
  answers: readonly MovementAnswers[],
): SelectionResult {
  const byId = new Map<string, MovementAnswers>()
  for (const answer of answers) {
    if (!byId.has(answer.movementId)) byId.set(answer.movementId, answer)
  }

  const index = new Map(catalog.movements.map((movement, position) => [movement.id, position]))
  const kept: MovementAnswers[] = []
  let sawAnswer = false

  for (const movement of catalog.movements) {
    const answer = byId.get(movement.id)
    if (!answer) continue
    sawAnswer = true
    if (!isEliminated(answer)) kept.push(answer)
  }

  if (!sawAnswer || kept.length === 0) {
    return { status: 'empty', reason: 'all-eliminated', rankedIds: [], suggestedIds: [] }
  }

  if (kept.every((answer) => answer.contraction === 0)) {
    return { status: 'empty', reason: 'all-zero', rankedIds: [], suggestedIds: [] }
  }

  const rankedIds = [...kept]
    .sort((a, b) => {
      if (b.contraction !== a.contraction) return b.contraction - a.contraction
      return (index.get(a.movementId) ?? 0) - (index.get(b.movementId) ?? 0)
    })
    .map((answer) => answer.movementId)

  return {
    status: 'plan',
    rankedIds,
    suggestedIds: rankedIds.slice(0, 3),
  }
}

/**
 * The person may change Sara's suggestion to any 1–3 movements that were not
 * eliminated. Returns those ids in rank order, or null when the choice is
 * outside 1–3 or includes an eliminated movement.
 */
export function adjustTopMovements(
  rankedIds: readonly string[],
  chosenIds: readonly string[],
): string[] | null {
  const allowed = new Set(rankedIds)
  const unique: string[] = []
  for (const id of chosenIds) {
    if (!allowed.has(id) || unique.includes(id)) continue
    unique.push(id)
  }
  if (unique.length < 1 || unique.length > 3) return null
  if (unique.length !== chosenIds.length) return null
  return rankedIds.filter((id) => unique.includes(id))
}
