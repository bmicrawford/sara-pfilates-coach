/**
 * Movement Selection Worksheet catalogs.
 *
 * The printed sheet is the source of the names, order, and three questions.
 * Catalogs are data so another list can be added later — for example the
 * 7-movement prolapse sheet, which drops Lunge, Squat, and Cat-Cow.
 * This app ships only the standard 10-movement worksheet. No other catalog
 * is offered in the UI.
 */

export type YesNo = 'yes' | 'no'
export type ContractionRating = 0 | 1 | 2 | 3

export type MovementDefinition = {
  id: string
  name: string
  /** High-probability PfilAtes movement. Essential wins a contraction-rating tie. */
  essential: boolean
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
  /**
   * Non-eliminated ids. Highest contraction first, then Essential before
   * low-probability, then worksheet order.
   */
  rankedIds: string[]
  /** Up to 3 ids Sara suggests. Empty when no plan is possible. */
  suggestedIds: string[]
}

export const WORKSHEET_TITLE = 'Movement Selection Worksheet'

export const WORKSHEET_INTRO =
  "Fill this out after you've learned the movements in the PfilAtes course."

export const PAIN_QUESTION = 'Does This Movement Cause Pain?'
export const REGULAR_QUESTION = 'Is This A Movement You Could Perform Regularly?'
export const CONTRACTION_QUESTION = 'Feeling of pelvic floor contraction'
export const CIRCLE_ANSWERS = 'Circle your answers'

export const CONTRACTION_SCALE: readonly { value: ContractionRating; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Slight' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Strong' },
]

export const ESSENTIAL_LABEL = 'Essential'

/** Shown while adjusting a plan that has a contraction-rating tie. */
export const ESSENTIAL_TIE_NOTE =
  'When a rating is tied, an Essential movement is the recommended pick.'

export const TOP_MOVEMENTS_TITLE = 'My top movements'
export const COURSE_LINE = 'As taught in your PfilAtes course.'

export const NO_EVERYDAY_PLAN_MESSAGE =
  'None of these movements are ready for an everyday plan. Review the movements in the PfilAtes course, and check with your clinician or pelvic floor PT.'

export const RESTART_CUE =
  "A missed day is just a missed day. Start again with today's movements whenever you're ready."

export const HEALTH_SCREEN_TITLE = 'Health screen'
export const HEALTH_OSTEOPOROSIS = 'Osteoporosis'
export const HEALTH_HIP_REPLACEMENT = 'Hip replacement'
export const HEALTH_PREGNANT = 'Pregnant'
export const HEALTH_WEEKS = 'How many weeks?'

export const NOT_RECOMMENDED = 'Not recommended for you'
export const REASON_OSTEOPOROSIS = 'osteoporosis'
export const REASON_HIP_REPLACEMENT = 'hip replacement'
export const REASON_PREGNANCY_AFTER_12 = 'pregnancy after 12 weeks'

export const PAIN_STOP_LINE = 'If a movement at any time causes pain, stop that movement.'
export const THIS_CAUSED_PAIN = 'This caused pain'
export const PAIN_REDO_LINE = 'Redo the worksheet to choose a replacement.'

export const SYMPTOM_CHECK_QUESTION =
  'Are your pelvic floor symptoms, such as incontinence, frequency, urgency, bulge, or painful intercourse, getting worse?'
export const SYMPTOMS_WORSE_LINK = 'My symptoms are getting worse'
export const STOP_ALL_MOVEMENTS_LINE =
  'Stop all movements and see a medical provider for a pelvic floor evaluation.'
export const RESUME_AFTER_EVALUATION = "I've been evaluated by a provider and cleared to continue."
export const WORKSHEET_REDO_PROMPT = 'Redo the worksheet.'

/** Whole weeks until an estimated gestational age is past 12 weeks. */
export const PREGNANCY_EXCLUSION_WEEKS = 12

export type HealthFlags = {
  osteoporosis: YesNo
  hipReplacement: YesNo
  pregnant: YesNo
  /** Local calendar date when gestational age is estimated to reach 12 weeks. */
  twelveWeekDate: string | null
}

const HIP_REPLACEMENT_MOVEMENTS = new Set([
  'side-lying-bent-knee-lift',
  'side-lying-straight-leg-circle',
  'butterfly',
  'all-4s-side-leg-lift',
])

const PREGNANCY_AFTER_12_MOVEMENTS = new Set(['butterfly', 'bridging', 'corkscrew'])

/** Names, order, and Essential flags. Essential marks the high-probability movements. */
export const STANDARD_MOVEMENT_CATALOG: MovementCatalog = {
  id: 'standard',
  title: WORKSHEET_TITLE,
  movements: [
    { id: 'lunge', name: 'Lunge', essential: true },
    { id: 'squat', name: 'Squat', essential: false },
    { id: 'side-lying-bent-knee-lift', name: 'Side-lying bent knee lift', essential: false },
    { id: 'side-lying-straight-leg-circle', name: 'Side-lying straight leg circle', essential: false },
    { id: 'butterfly', name: 'Butterfly', essential: true },
    { id: 'bridging', name: 'Bridging', essential: true },
    { id: 'corkscrew', name: 'Corkscrew', essential: false },
    { id: 'hovering', name: 'Hovering', essential: true },
    { id: 'all-4s-side-leg-lift', name: 'All-4s side leg lift', essential: false },
    { id: 'cat-cow', name: 'Cat-Cow', essential: true },
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

export function movementIsEssential(id: string, catalog: MovementCatalog = STANDARD_MOVEMENT_CATALOG): boolean {
  return catalog.movements.find((movement) => movement.id === id)?.essential === true
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Local date when the entered whole-week count reaches 12 weeks.
 * Exclusion starts the following day: that is past 12 weeks, "pregnancy after 12 weeks".
 */
export function estimateTwelveWeekDate(weeksPregnant: number, today = new Date()): string {
  const weeks = Math.trunc(weeksPregnant)
  return localDayKey(addLocalDays(startOfLocalDay(today), (PREGNANCY_EXCLUSION_WEEKS - weeks) * 7))
}

export function parseWeeksPregnant(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d{1,2}$/.test(trimmed)) return null
  return Number(trimmed)
}

export function pregnancyAfterTwelveWeeks(health: HealthFlags | null, today = new Date()): boolean {
  if (!health || health.pregnant !== 'yes' || !health.twelveWeekDate) return false
  return localDayKey(startOfLocalDay(today)) > health.twelveWeekDate
}

/** Reasons this movement cannot be selected. Empty when it can. */
export function exclusionReasons(movementId: string, health: HealthFlags | null, today = new Date()): string[] {
  if (!health) return []
  const reasons: string[] = []
  if (health.osteoporosis === 'yes' && movementId === 'cat-cow') reasons.push(REASON_OSTEOPOROSIS)
  if (health.hipReplacement === 'yes' && HIP_REPLACEMENT_MOVEMENTS.has(movementId)) {
    reasons.push(REASON_HIP_REPLACEMENT)
  }
  if (pregnancyAfterTwelveWeeks(health, today) && PREGNANCY_AFTER_12_MOVEMENTS.has(movementId)) {
    reasons.push(REASON_PREGNANCY_AFTER_12)
  }
  return reasons
}

export function excludedMovementIds(health: HealthFlags | null, today = new Date()): string[] {
  return STANDARD_MOVEMENT_CATALOG.movements
    .map((movement) => movement.id)
    .filter((id) => exclusionReasons(id, health, today).length > 0)
}

/** True when two or more kept movements share a contraction rating. */
export function selectionHasRatingTie(
  catalog: MovementCatalog,
  answers: readonly MovementAnswers[],
  excludedIds: readonly string[] = [],
): boolean {
  const selection = selectTopMovements(catalog, answers, excludedIds)
  if (selection.status !== 'plan') return false
  const seen = new Set<ContractionRating>()
  for (const id of selection.rankedIds) {
    const rating = answers.find((answer) => answer.movementId === id)?.contraction
    if (rating === undefined) continue
    if (seen.has(rating)) return true
    seen.add(rating)
  }
  return false
}

/** Yes on pain, or No on "could perform regularly", drops the movement. */
export function isEliminated(answer: Pick<MovementAnswers, 'pain' | 'regular'>): boolean {
  return answer.pain === 'yes' || answer.regular === 'no'
}

/**
 * Among movements that were not eliminated, suggest the top 3 by contraction
 * rating. A tie prefers an Essential movement, then worksheet order. If every
 * movement is eliminated, or every remaining movement is rated 0, there is no plan.
 */
export function selectTopMovements(
  catalog: MovementCatalog,
  answers: readonly MovementAnswers[],
  excludedIds: readonly string[] = [],
): SelectionResult {
  const byId = new Map<string, MovementAnswers>()
  for (const answer of answers) {
    if (!byId.has(answer.movementId)) byId.set(answer.movementId, answer)
  }

  const excluded = new Set(excludedIds)
  const index = new Map(catalog.movements.map((movement, position) => [movement.id, position]))
  const essential = new Map(catalog.movements.map((movement) => [movement.id, movement.essential]))
  const kept: MovementAnswers[] = []
  let sawAnswer = false

  for (const movement of catalog.movements) {
    if (excluded.has(movement.id)) {
      sawAnswer = true
      continue
    }
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
      const essentialDelta = Number(essential.get(b.movementId) === true) - Number(essential.get(a.movementId) === true)
      if (essentialDelta !== 0) return essentialDelta
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
