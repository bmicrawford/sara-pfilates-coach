import { readFileSync } from 'node:fs'
import { exerciseLogs } from './diary.ts'
import { EXERCISE_DAILY_MINUTES, fourWeekExerciseReport } from './exercise.ts'
import { exerciseLogPdfPlainText, exerciseLogPdfDoc } from './exercisePdf.ts'
import { addLog, readLogs } from './mockServer.ts'
import {
  MOVEMENT_PLAN_STORAGE_KEY,
  adherenceSummary,
  completeAnswers,
  everydayMovementsAskContext,
  readMovementPlan,
  readReminderTime,
  saveWorksheetResult,
  setEverydayMovementDone,
  shouldShowRestartCue,
  writeReminderTime,
  writeWorksheetDraft,
  blankDraft,
} from './movementPlan.ts'
import {
  CIRCLE_ANSWERS,
  CONTRACTION_QUESTION,
  CONTRACTION_SCALE,
  COURSE_LINE,
  ESSENTIAL_TIE_NOTE,
  MOVEMENT_CATALOGS,
  NO_EVERYDAY_PLAN_MESSAGE,
  PAIN_QUESTION,
  REGULAR_QUESTION,
  RESTART_CUE,
  STANDARD_MOVEMENT_CATALOG,
  TOP_MOVEMENTS_TITLE,
  WORKSHEET_INTRO,
  WORKSHEET_TITLE,
  adjustTopMovements,
  isEliminated,
  movementIsEssential,
  selectTopMovements,
  selectionHasRatingTie,
  type ContractionRating,
  type MovementAnswers,
  type MovementDefinition,
  type YesNo,
} from './movements.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

const memory = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
} as Storage

function row(
  movementId: string,
  pain: YesNo,
  regular: YesNo,
  contraction: ContractionRating,
): MovementAnswers {
  return { movementId, pain, regular, contraction }
}

function sheet(
  kept: Record<string, ContractionRating | { pain: YesNo; regular: YesNo; contraction: ContractionRating }>,
): MovementAnswers[] {
  return STANDARD_MOVEMENT_CATALOG.movements.map((movement) => {
    const spec = kept[movement.id]
    if (spec === undefined) return row(movement.id, 'yes', 'no', 0)
    if (typeof spec === 'number') return row(movement.id, 'no', 'yes', spec)
    return row(movement.id, spec.pain, spec.regular, spec.contraction)
  })
}

const EXPECTED_NAMES = [
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

assert(
  STANDARD_MOVEMENT_CATALOG.movements.map((movement) => movement.name).join('|') === EXPECTED_NAMES.join('|'),
  'standard worksheet names and order match the printed sheet',
)
assert(Object.keys(MOVEMENT_CATALOGS).join(',') === 'standard', 'only the 10-movement catalog ships')
assert(!('prolapse' in MOVEMENT_CATALOGS), 'prolapse variant is not shipped')
assert(WORKSHEET_TITLE === 'Movement Selection Worksheet', 'worksheet title matches the sheet')
assert(
  WORKSHEET_INTRO === "Fill this out after you've learned the movements in the PfilAtes course.",
  'intro is the course line',
)
assert(PAIN_QUESTION === 'Does This Movement Cause Pain?', 'pain question matches the sheet')
assert(
  REGULAR_QUESTION === 'Is This A Movement You Could Perform Regularly?',
  'regular question matches the sheet',
)
assert(CONTRACTION_QUESTION === 'Feeling of pelvic floor contraction', 'contraction question uses the corrected wording')
assert(
  CONTRACTION_SCALE.map((item) => `${item.value} ${item.label}`).join(', ') ===
    '0 None, 1 Slight, 2 Moderate, 3 Strong',
  'contraction scale is None, Slight, Moderate, Strong',
)
assert(
  STANDARD_MOVEMENT_CATALOG.movements
    .filter((movement) => movement.essential)
    .map((movement) => movement.name)
    .join('|') === 'Squat|Butterfly|Bridging|Hovering|Cat-Cow',
  'essential movements are 2, 5, 6, 8, and 10',
)
assert(
  STANDARD_MOVEMENT_CATALOG.movements.every((movement, index) => movement.essential === [1, 4, 5, 7, 9].includes(index)),
  'essential flags sit on worksheet positions 2, 5, 6, 8, and 10',
)
assert(CIRCLE_ANSWERS === 'Circle your answers', 'circle-your-answers note is kept')
assert(TOP_MOVEMENTS_TITLE === 'My top movements', 'result title matches the sheet')
assert(COURSE_LINE === 'As taught in your PfilAtes course.', 'course line does not invent instructions')
assert(/clinician or pelvic floor PT/.test(NO_EVERYDAY_PLAN_MESSAGE), 'empty plan points at the course and a clinician')
assert(!/cure|treat|diagnos|heal|safe to/i.test(NO_EVERYDAY_PLAN_MESSAGE), 'empty plan makes no medical claim')
assert(!/you failed|streak broken|behind/i.test(RESTART_CUE), 'restart cue is not a scolding')

assert(isEliminated(row('lunge', 'yes', 'yes', 3)), 'pain Yes eliminates even with a strong contraction')
assert(isEliminated(row('lunge', 'no', 'no', 3)), 'regular No eliminates even with a strong contraction')
assert(!isEliminated(row('lunge', 'no', 'yes', 0)), 'pain No and regular Yes keeps the movement')

const painDropsStrong = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({
    lunge: { pain: 'yes', regular: 'yes', contraction: 3 },
    squat: 1,
  }),
)
assert(painDropsStrong.status === 'plan', 'a painful movement does not block a plan')
assert(!painDropsStrong.rankedIds.includes('lunge'), 'pain Yes is left out of the ranking')
assert(painDropsStrong.suggestedIds.join(',') === 'squat', 'the kept movement is suggested')

const irregularDrops = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({
    bridging: { pain: 'no', regular: 'no', contraction: 3 },
    butterfly: 2,
  }),
)
assert(!irregularDrops.rankedIds.includes('bridging'), 'regular No is left out of the ranking')
assert(irregularDrops.suggestedIds.join(',') === 'butterfly', 'only the regular movement is suggested')

const ranked = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({
    lunge: 2,
    squat: 3,
    'side-lying-bent-knee-lift': 1,
    'side-lying-straight-leg-circle': 0,
    butterfly: 3,
    bridging: 2,
  }),
)
assert(ranked.status === 'plan', 'mixed ratings produce a plan')
assert(
  ranked.rankedIds.join(',') ===
    'squat,butterfly,bridging,lunge,side-lying-bent-knee-lift,side-lying-straight-leg-circle',
  'ranking is contraction desc, then Essential, then worksheet order',
)
assert(ranked.suggestedIds.join(',') === 'squat,butterfly,bridging', 'top 3 drops the fourth-highest')
assert(ranked.suggestedIds[0] === 'squat' && ranked.suggestedIds[1] === 'butterfly', 'two Essential 3s keep Squat before Butterfly')
assert(ranked.rankedIds[2] === 'bridging' && ranked.rankedIds[3] === 'lunge', 'Essential Bridging beats low-probability Lunge at the same rating')

const essentialFirst = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({ lunge: 3, squat: 3 }),
)
assert(essentialFirst.suggestedIds.join(',') === 'squat,lunge', 'Essential Squat beats earlier Lunge when the rating is tied')
assert(selectionHasRatingTie(STANDARD_MOVEMENT_CATALOG, sheet({ lunge: 3, squat: 3 })), 'a rating tie is visible while adjusting')
assert(
  !selectionHasRatingTie(STANDARD_MOVEMENT_CATALOG, sheet({ lunge: 3, squat: 2 })),
  'unique ratings are not a tie',
)
assert(/Essential/.test(ESSENTIAL_TIE_NOTE) && /recommended/.test(ESSENTIAL_TIE_NOTE), 'tie note recommends Essential without a medical claim')
assert(!/cure|treat|diagnos/i.test(ESSENTIAL_TIE_NOTE), 'tie note makes no medical claim')

const bothEssential = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({ butterfly: 2, squat: 2 }),
)
assert(bothEssential.suggestedIds.join(',') === 'squat,butterfly', 'two Essential movements at the same rating keep worksheet order')

const bothLow = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({ corkscrew: 2, lunge: 2 }),
)
assert(bothLow.suggestedIds.join(',') === 'lunge,corkscrew', 'two low-probability movements at the same rating keep worksheet order')

const tied = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({ lunge: 2, squat: 2, hovering: 2 }),
)
assert(tied.suggestedIds.join(',') === 'squat,hovering,lunge', 'Essential movements lead a three-way rating tie, then worksheet order')
assert(movementIsEssential('squat') && movementIsEssential('hovering') && !movementIsEssential('lunge'), 'tie-break fixture matches essential flags')

const eliminated = selectTopMovements(STANDARD_MOVEMENT_CATALOG, sheet({}))
assert(eliminated.status === 'empty' && eliminated.reason === 'all-eliminated', 'every eliminated movement makes no plan')
assert(eliminated.suggestedIds.length === 0 && eliminated.rankedIds.length === 0, 'an eliminated sheet suggests nothing')

const zeros = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet(
    Object.fromEntries(STANDARD_MOVEMENT_CATALOG.movements.map((movement: MovementDefinition) => [movement.id, 0])),
  ),
)
assert(zeros.status === 'empty' && zeros.reason === 'all-zero', 'all remaining ratings of 0 make no plan')
assert(zeros.suggestedIds.length === 0, 'a zero sheet suggests nothing')

const zerosAfterPain = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({
    lunge: { pain: 'yes', regular: 'yes', contraction: 3 },
    squat: 0,
    bridging: 0,
  }),
)
assert(zerosAfterPain.reason === 'all-zero', 'zeros that remain after elimination are still an empty plan')

const zerosFillTop = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({ lunge: 2, squat: 0, butterfly: 0 }),
)
assert(
  zerosFillTop.suggestedIds.join(',') === 'lunge,squat,butterfly',
  'a single higher rating still suggests the next worksheet-order zeros up to 3',
)

const one = adjustTopMovements(ranked.rankedIds, ['bridging'])
assert(one?.join(',') === 'bridging', 'the person can keep a single eligible movement')
const three = adjustTopMovements(ranked.rankedIds, ['bridging', 'squat', 'lunge'])
assert(three?.join(',') === 'squat,bridging,lunge', 'an adjusted set is returned in rank order, not tap order')
assert(adjustTopMovements(ranked.rankedIds, ['squat', 'butterfly', 'lunge', 'bridging']) === null, 'four movements is not a plan')
assert(adjustTopMovements(ranked.rankedIds, []) === null, 'zero movements is not a plan')
assert(adjustTopMovements(ranked.rankedIds, ['lunge', 'corkscrew']) === null, 'an eliminated movement cannot be added')
assert(adjustTopMovements(ranked.rankedIds, ['squat', 'squat']) === null, 'a duplicate choice is rejected')

const partial = selectTopMovements(
  STANDARD_MOVEMENT_CATALOG,
  sheet({ squat: 2 }).filter((answer) => answer.movementId !== 'lunge'),
)
assert(partial.suggestedIds.join(',') === 'squat', 'a missing answer is skipped rather than treated as a zero')

memory.clear()
const incomplete = saveWorksheetResult(sheet({ squat: 2 }).slice(0, 3), ['squat'])
assert(!incomplete.ok && incomplete.ok === false && incomplete.reason === 'incomplete', 'a partial sheet is not saved')
assert(readMovementPlan().history.length === 0, 'a rejected sheet does not enter history')

const planAnswers = sheet({ lunge: 3, bridging: 2, 'cat-cow': 1 })
const planSelection = selectTopMovements(STANDARD_MOVEMENT_CATALOG, planAnswers)
assert(planSelection.suggestedIds.join(',') === 'lunge,bridging,cat-cow', 'fixture suggestion is the three kept movements')

const firstSaved = saveWorksheetResult(planAnswers, planSelection.suggestedIds, new Date(2026, 8, 20, 12, 0, 0))
assert(firstSaved.ok, 'a complete worksheet saves')
assert(localStorage.getItem('sara.' + MOVEMENT_PLAN_STORAGE_KEY), 'worksheet state uses the sara.movementPlan key')
assert(readMovementPlan().currentId === (firstSaved.ok ? firstSaved.state.currentId : ''), 'current id points at the save')

const second = saveWorksheetResult(sheet({ squat: 3, hovering: 2 }), ['hovering'], new Date(2026, 8, 26, 9, 0, 0))
assert(second.ok, 'a redo saves')
const afterRedo = readMovementPlan()
assert(afterRedo.history.length === 2, 'redo keeps the earlier worksheet')
assert(afterRedo.history[0]?.selectedIds.join(',') === 'hovering', 'the newest result is current')
assert(afterRedo.history[1]?.selectedIds.join(',') === 'lunge,bridging,cat-cow', 'the first result stays in history')
assert(afterRedo.currentId === afterRedo.history[0]?.id, 'current id follows the redo')

const emptySaved = saveWorksheetResult(
  sheet(Object.fromEntries(STANDARD_MOVEMENT_CATALOG.movements.map((movement) => [movement.id, 0]))),
  [],
  new Date(2026, 8, 27, 8, 0, 0),
)
assert(emptySaved.ok && emptySaved.state.history[0]?.status === 'empty', 'an all-zero sheet is saved without a plan')
assert(emptySaved.ok && emptySaved.state.history[0]?.selectedIds.length === 0, 'an empty result selects nothing')
assert(emptySaved.ok && emptySaved.state.history.length === 3, 'the empty result does not erase earlier plans')
assert(everydayMovementsAskContext() === '', 'Ask Sara gets no movement context when there is no plan')

memory.clear()
const manualAt = new Date(2026, 8, 27, 8, 0, 0)
addLog({
  id: 'manual-pfilates',
  kind: 'exercise',
  at: manualAt.toISOString(),
  activity: 'PfilAtes',
  minutes: '10',
  felt: 'Just right',
})
const loggedPlan = saveWorksheetResult(planAnswers, ['lunge', 'bridging', 'cat-cow'], new Date(2026, 8, 20, 12, 0, 0))
assert(loggedPlan.ok, 'plan for the exercise log saves')
const doneAt = new Date(2026, 8, 27, 15, 30, 0)
let checking = readMovementPlan()
for (const id of ['lunge', 'bridging', 'cat-cow']) {
  checking = setEverydayMovementDone(id, true, doneAt)
}
const logsAfter = readLogs()
const planLogs = exerciseLogs(logsAfter).filter((log) => log.id !== 'manual-pfilates')
assert(planLogs.length === 1, 'finishing the day writes one exercise session')
assert(planLogs[0]?.minutes === String(EXERCISE_DAILY_MINUTES), 'the session uses the existing 5-minute daily unit')
assert(planLogs[0]?.activity === 'Lunge · Bridging · Cat-Cow', 'the session names the everyday movements')
assert(planLogs[0]?.felt === '', 'the session does not invent a feeling')
assert(logsAfter.some((log) => log.id === 'manual-pfilates'), 'a session already in the log stays')
const report = fourWeekExerciseReport(logsAfter, { now: doneAt.toISOString() })
const today = report.days.find((day) => day.items.some((item) => item.id === 'manual-pfilates'))
assert(today && today.minutes === 15 && today.sessions === 2, 'the 4-week log adds the plan session beside the existing one')
const pdfText = exerciseLogPdfPlainText(exerciseLogPdfDoc(report))
assert(pdfText.includes('Lunge · Bridging · Cat-Cow · 5 min'), 'the exercise PDF lists the everyday movements')
assert(pdfText.includes('PfilAtes · 10 min'), 'the exercise PDF still lists the existing session')

const undone = setEverydayMovementDone('bridging', false, doneAt)
assert(!readLogs().some((log) => log.id === planLogs[0]?.id), 'unchecking removes only the plan session')
assert(readLogs().some((log) => log.id === 'manual-pfilates'), 'unchecking leaves the existing session')
assert(undone.days[0]?.exerciseLogId === undefined, 'the day no longer points at a log')
const again = setEverydayMovementDone('bridging', true, doneAt)
assert(exerciseLogs(readLogs()).filter((log) => log.id !== 'manual-pfilates').length === 1, 'rechecking writes one session again')
assert(again.days[0]?.exerciseLogId, 'the new session id is stored on the day')

memory.clear()
saveWorksheetResult(planAnswers, ['lunge', 'bridging', 'cat-cow'], new Date(2026, 8, 20, 12, 0, 0))
for (const day of [21, 22, 23, 24, 25]) {
  const when = new Date(2026, 8, day, 10, 0, 0)
  for (const id of ['lunge', 'bridging', 'cat-cow']) setEverydayMovementDone(id, true, when)
}
const sep27 = new Date(2026, 8, 27, 15, 0, 0)
const streak = adherenceSummary(readMovementPlan(), sep27)
assert(streak.line === '5 of last 7 days', 'adherence counts completed days in the last 7')
assert(shouldShowRestartCue(readMovementPlan(), sep27), 'a missed yesterday shows the restart cue')
for (const id of ['lunge', 'bridging', 'cat-cow']) setEverydayMovementDone(id, true, sep27)
assert(!shouldShowRestartCue(readMovementPlan(), sep27), 'finishing today clears the restart cue')
assert(adherenceSummary(readMovementPlan(), sep27).line === '6 of last 7 days', 'today counts once it is finished')

memory.clear()
saveWorksheetResult(planAnswers, ['cat-cow'], new Date(2026, 8, 27, 9, 0, 0))
assert(!shouldShowRestartCue(readMovementPlan(), sep27), 'the first day of a plan is not treated as a missed yesterday')

memory.clear()
assert(writeReminderTime('07:30').reminderTime === '07:30', 'reminder time is saved on the phone')
assert(readReminderTime() === '07:30', 'reminder time reads back')
assert(writeReminderTime('25:99').reminderTime === null, 'an impossible reminder time is not stored')
assert(writeReminderTime('').reminderTime === null, 'clearing the reminder time removes it')

memory.clear()
saveWorksheetResult(planAnswers, ['bridging', 'lunge'], new Date(2026, 8, 27, 9, 0, 0))
const context = everydayMovementsAskContext()
assert(context.includes('Lunge') && context.includes('Bridging'), 'Ask Sara context names the current movements')
assert(context.indexOf('Lunge') < context.indexOf('Bridging'), 'Ask Sara context uses rank order')
assert(/Kajabi|PfilAtes course/.test(context), 'Ask Sara context keeps the course as the source')
assert(!/step|inhale|exhale|reps|sets/i.test(context), 'Ask Sara context does not invent instructions')
assert(!/prolapse/i.test(context), 'Ask Sara context does not mention an unshipped variant')

const draft = blankDraft()
draft[0] = { ...draft[0], pain: 'no', regular: 'yes', contraction: 2 }
writeWorksheetDraft(draft)
assert(readMovementPlan().draft?.[0]?.contraction === 2, 'an in-progress worksheet stays on the phone')
assert(completeAnswers(draft) === null, 'a draft is incomplete until every movement is answered')
assert(completeAnswers(planAnswers.map((answer) => ({ ...answer })))?.length === 10, 'a full draft completes')

const page = readFileSync(new URL('../pages/Worksheet.tsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
const planCard = readFileSync(new URL('../components/TodayPlan.tsx', import.meta.url), 'utf8')
const askPage = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../../worker/src/index.js', import.meta.url), 'utf8')
assert(!/prolapse/i.test(page + home + planCard), 'worksheet UI does not ship the prolapse variant')
assert(/TodayPlanCard/.test(home) && /MovementPhoneSettings/.test(home), 'Home shows the plan and the phone settings')
assert(/to="\/ask"/.test(home) && /openSheet\('exercise'\)/.test(home), 'Home keeps Ask Sara and the exercise sheet')
assert(/everydayMovementsAskContext/.test(askPage), 'Ask Sara sends the everyday movements when asking')
assert(/context: typeof body\.context === 'string'/.test(worker), 'the worker forwards optional ask context')

if (process.exitCode) {
  console.error('movement smoke failed')
  process.exit(1)
}
console.log('movement smoke passed')
