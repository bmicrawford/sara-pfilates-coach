import { addLocalDays, EXERCISE_DAILY_MINUTES, localDayKeyFromDate, startOfLocalDay } from './exercise.ts'
import { addDiaryLog, readLogs, removeLog } from './mockServer.ts'
import {
  COURSE_LINE,
  STANDARD_MOVEMENT_CATALOG,
  adjustTopMovements,
  estimateTwelveWeekDate,
  excludedMovementIds,
  movementName,
  pregnancyAfterTwelveWeeks,
  selectTopMovements,
  type ContractionRating,
  type HealthFlags,
  type MovementAnswers,
  type YesNo,
} from './movements.ts'
import { readJson, uid, writeJson } from './storage.ts'
import type { ExerciseLog } from './types.ts'

/** localStorage key `sara.movementPlan`. Worksheet history, today's checks, reminder stub. */
export const MOVEMENT_PLAN_STORAGE_KEY = 'movementPlan'

export const EVERYDAY_PLAN_MINUTES = String(EXERCISE_DAILY_MINUTES)

export const REMINDER_TIME_HINT = 'Saved on this phone. Reminders are not sent yet.'

export type DraftAnswer = {
  movementId: string
  pain: YesNo | null
  regular: YesNo | null
  contraction: ContractionRating | null
}

export type WorksheetRecord = {
  id: string
  catalogId: string
  completedAt: string
  answers: MovementAnswers[]
  status: 'plan' | 'empty'
  emptyReason?: 'all-eliminated' | 'all-zero'
  rankedIds: string[]
  suggestedIds: string[]
  selectedIds: string[]
}

export type PlanDay = {
  day: string
  checkedIds: string[]
  exerciseLogId?: string
}

export type HealthScreen = HealthFlags & {
  weeksPregnant: number | null
  answeredAt: string
}

export type SymptomPause = {
  pausedAt: string
  resumedAt: string | null
}

export type MovementPlanState = {
  history: WorksheetRecord[]
  currentId: string | null
  draft: DraftAnswer[] | null
  days: PlanDay[]
  /** `HH:MM` 24-hour preference. Not a live notification. */
  reminderTime: string | null
  health: HealthScreen | null
  symptomPauses: SymptomPause[]
  lastSymptomCheckAt: string | null
  /** Pregnancy progression removed the last everyday movement. */
  worksheetRedoPrompt: boolean
  /** A daily-plan movement was stopped because it caused pain. */
  painRedoPrompt: boolean
}

const EMPTY_STATE: MovementPlanState = {
  history: [],
  currentId: null,
  draft: null,
  days: [],
  reminderTime: null,
  health: null,
  symptomPauses: [],
  lastSymptomCheckAt: null,
  worksheetRedoPrompt: false,
  painRedoPrompt: false,
}

/** Days between symptom check-ins on the daily plan. */
export const SYMPTOM_CHECK_EVERY_DAYS = 7

const HISTORY_LIMIT = 40
const DAY_LIMIT = 60

export function blankDraft(
  catalog = STANDARD_MOVEMENT_CATALOG,
): DraftAnswer[] {
  return catalog.movements.map((movement) => ({
    movementId: movement.id,
    pain: null,
    regular: null,
    contraction: null,
  }))
}

export function completeAnswers(
  draft: readonly DraftAnswer[],
  excludedIds: readonly string[] = [],
): MovementAnswers[] | null {
  const excluded = new Set(excludedIds)
  const byId = new Map(draft.map((row) => [row.movementId, row]))
  const out: MovementAnswers[] = []
  for (const movement of STANDARD_MOVEMENT_CATALOG.movements) {
    if (excluded.has(movement.id)) continue
    const row = byId.get(movement.id)
    if (!row) return null
    if (row.pain !== 'yes' && row.pain !== 'no') return null
    if (row.regular !== 'yes' && row.regular !== 'no') return null
    if (row.contraction !== 0 && row.contraction !== 1 && row.contraction !== 2 && row.contraction !== 3) {
      return null
    }
    out.push({
      movementId: row.movementId,
      pain: row.pain,
      regular: row.regular,
      contraction: row.contraction,
    })
  }
  return out
}

export function readMovementPlan(): MovementPlanState {
  return sanitize(readJson<unknown>(MOVEMENT_PLAN_STORAGE_KEY, null))
}

export function writeWorksheetDraft(draft: DraftAnswer[]): MovementPlanState {
  const next = { ...readMovementPlan(), draft }
  persist(next)
  return next
}

export function clearWorksheetDraft(): MovementPlanState {
  const next = { ...readMovementPlan(), draft: null }
  persist(next)
  return next
}

export function currentWorksheet(state: MovementPlanState = readMovementPlan()): WorksheetRecord | null {
  if (state.currentId) {
    const match = state.history.find((record) => record.id === state.currentId)
    if (match) return match
  }
  return state.history[0] ?? null
}

export function everydayMovementIds(state: MovementPlanState = readMovementPlan()): string[] {
  return currentWorksheet(state)?.selectedIds ?? []
}

export function everydayMovementNames(state: MovementPlanState = readMovementPlan()): string[] {
  return everydayMovementIds(state).map((id) => movementName(id))
}

/**
 * Optional Ask Sara context. Empty when there is no everyday plan, so the
 * request stays unchanged for people who have not filled out the worksheet.
 */
export function everydayMovementsAskContext(state: MovementPlanState = readMovementPlan()): string {
  if (isPlanPaused(state)) return ''
  const names = everydayMovementNames(state)
  if (names.length === 0) return ''
  return `The person's current everyday movements, chosen on their Movement Selection Worksheet, are: ${names.join('; ')}. ${COURSE_LINE} They are done as taught in the PfilAtes course on Kajabi. Do not invent exercise instructions, and do not suggest movements they did not choose.`
}

export function saveWorksheetResult(
  answers: readonly MovementAnswers[],
  chosenIds: readonly string[],
  now = new Date(),
): { ok: true; state: MovementPlanState } | { ok: false; reason: 'incomplete' | 'selection' } {
  const state = readMovementPlan()
  const excluded = excludedMovementIds(state.health, now)
  const excludedSet = new Set(excluded)
  const usable = answers.filter((answer) => !excludedSet.has(answer.movementId))
  const usableIds = new Set(usable.map((answer) => answer.movementId))
  const required = STANDARD_MOVEMENT_CATALOG.movements.filter((movement) => !excludedSet.has(movement.id))
  if (!required.every((movement) => usableIds.has(movement.id))) {
    return { ok: false, reason: 'incomplete' }
  }
  if (chosenIds.some((id) => excludedSet.has(id))) return { ok: false, reason: 'selection' }

  const today = localDayKeyFromDate(startOfLocalDay(now))
  const todayProgress = state.days.find((day) => day.day === today)
  if (todayProgress?.exerciseLogId) removeLog(todayProgress.exerciseLogId)

  const selection = selectTopMovements(STANDARD_MOVEMENT_CATALOG, usable, excluded)
  let selectedIds: string[] = []
  if (selection.status === 'plan') {
    const adjusted = adjustTopMovements(selection.rankedIds, chosenIds)
    if (!adjusted) return { ok: false, reason: 'selection' }
    selectedIds = adjusted
  }

  const record: WorksheetRecord = {
    id: uid(),
    catalogId: STANDARD_MOVEMENT_CATALOG.id,
    completedAt: now.toISOString(),
    answers: usable.map((answer) => ({ ...answer })),
    status: selection.status,
    emptyReason: selection.reason,
    rankedIds: selection.rankedIds,
    suggestedIds: selection.suggestedIds,
    selectedIds,
  }

  const next: MovementPlanState = {
    ...state,
    history: [record, ...state.history].slice(0, HISTORY_LIMIT),
    currentId: record.id,
    draft: null,
    days: state.days
      .filter((day) => day.day !== today)
      .slice(0, DAY_LIMIT),
    worksheetRedoPrompt: false,
    painRedoPrompt: false,
  }
  persist(next)
  return { ok: true, state: next }
}

export function checkedToday(state: MovementPlanState = readMovementPlan(), now = new Date()): string[] {
  const today = localDayKeyFromDate(startOfLocalDay(now))
  return state.days.find((day) => day.day === today)?.checkedIds ?? []
}

export function todayPlanComplete(state: MovementPlanState = readMovementPlan(), now = new Date()): boolean {
  const selected = everydayMovementIds(state)
  if (selected.length === 0) return false
  const checked = new Set(checkedToday(state, now))
  return selected.every((id) => checked.has(id))
}

/**
 * Check or uncheck one everyday movement for the local day.
 * When every current movement is checked, one exercise-log session is written
 * so the existing 4-week report and PDF include the day. Unchecking removes
 * only that session.
 */
export function setEverydayMovementDone(
  movementId: string,
  done: boolean,
  now = new Date(),
): MovementPlanState {
  const state = readMovementPlan()
  if (isPlanPaused(state)) return state
  const selected = everydayMovementIds(state)
  if (!selected.includes(movementId)) return state

  const day = localDayKeyFromDate(startOfLocalDay(now))
  const existing = state.days.find((entry) => entry.day === day)
  const prior = new Set(existing?.checkedIds ?? [])
  if (done) prior.add(movementId)
  else prior.delete(movementId)
  const checkedIds = selected.filter((id) => prior.has(id))
  const complete = selected.every((id) => checkedIds.includes(id))

  let exerciseLogId = existing?.exerciseLogId
  if (complete) {
    if (!exerciseLogId || !readLogs().some((log) => log.id === exerciseLogId)) {
      exerciseLogId = writePlanExerciseLog(selected, now)
    }
  } else if (exerciseLogId) {
    removeLog(exerciseLogId)
    exerciseLogId = undefined
  }

  const progress: PlanDay = {
    day,
    checkedIds,
    ...(exerciseLogId ? { exerciseLogId } : {}),
  }
  const days = [progress, ...state.days.filter((entry) => entry.day !== day)].slice(0, DAY_LIMIT)
  const next = { ...state, days }
  persist(next)
  return next
}

export function adherenceSummary(
  state: MovementPlanState = readMovementPlan(),
  now = new Date(),
): { done: number; days: number; line: string } {
  const days = 7
  let done = 0
  const start = startOfLocalDay(now)
  for (let offset = 0; offset < days; offset += 1) {
    if (dayWasCompleted(state, addLocalDays(start, -offset))) done += 1
  }
  return { done, days, line: `${done} of last ${days} days` }
}

export function shouldShowRestartCue(
  state: MovementPlanState = readMovementPlan(),
  now = new Date(),
): boolean {
  if (everydayMovementIds(state).length === 0) return false
  if (todayPlanComplete(state, now)) return false
  const yesterday = addLocalDays(startOfLocalDay(now), -1)
  const active = worksheetActiveOn(state, endOfLocalDay(yesterday))
  if (!active || active.selectedIds.length === 0) return false
  return !dayWasCompleted(state, yesterday)
}

/** Future reminder PR can read this. Nothing is scheduled or sent from here. */
export function readReminderTime(state: MovementPlanState = readMovementPlan()): string | null {
  return state.reminderTime
}

export function writeReminderTime(value: string | null): MovementPlanState {
  const next = { ...readMovementPlan(), reminderTime: normalizeReminderTime(value) }
  persist(next)
  return next
}

export type HealthScreenInput = {
  osteoporosis: YesNo
  hipReplacement: YesNo
  pregnant: YesNo
  weeksPregnant: number | null
}

export function saveHealthScreen(input: HealthScreenInput, now = new Date()): MovementPlanState {
  const pregnant = input.pregnant === 'yes'
  const weeks = pregnant && typeof input.weeksPregnant === 'number' ? Math.trunc(input.weeksPregnant) : null
  if (input.osteoporosis !== 'yes' && input.osteoporosis !== 'no') return readMovementPlan()
  if (input.hipReplacement !== 'yes' && input.hipReplacement !== 'no') return readMovementPlan()
  if (input.pregnant !== 'yes' && input.pregnant !== 'no') return readMovementPlan()
  if (pregnant && (weeks === null || weeks < 0 || weeks > 99)) return readMovementPlan()

  const health: HealthScreen = {
    osteoporosis: input.osteoporosis,
    hipReplacement: input.hipReplacement,
    pregnant: input.pregnant,
    weeksPregnant: pregnant ? weeks : null,
    twelveWeekDate: pregnant && weeks !== null ? estimateTwelveWeekDate(weeks, now) : null,
    answeredAt: now.toISOString(),
  }
  const next = stripExcludedMovements({ ...readMovementPlan(), health }, now)
  persist(next)
  return next
}

/** Drop movements the health screen now excludes. Prompts a redo only when the plan hits zero. */
export function syncPregnancyExclusions(now = new Date()): MovementPlanState {
  const state = readMovementPlan()
  if (!pregnancyAfterTwelveWeeks(state.health, now)) return state
  const next = stripExcludedMovements(state, now)
  if (next === state) return state
  persist(next)
  return next
}

export function stopMovementForPain(movementId: string, now = new Date()): MovementPlanState {
  const state = readMovementPlan()
  const current = currentWorksheet(state)
  if (!current || !current.selectedIds.includes(movementId)) return state

  const answers = current.answers.map((answer) =>
    answer.movementId === movementId ? { ...answer, pain: 'yes' as const } : answer,
  )
  const excluded = excludedMovementIds(state.health, now)
  const selection = selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers, excluded)
  const selectedIds = current.selectedIds.filter((id) => id !== movementId && selection.rankedIds.includes(id))
  const record: WorksheetRecord = {
    ...current,
    answers,
    status: selection.status,
    emptyReason: selection.reason,
    rankedIds: selection.rankedIds,
    suggestedIds: selection.suggestedIds,
    selectedIds,
  }
  const history = state.history.map((item) => (item.id === record.id ? record : item))
  const next: MovementPlanState = {
    ...state,
    history,
    days: alignToday({ ...state, history }, selectedIds, now),
    painRedoPrompt: true,
  }
  persist(next)
  return next
}

export function isPlanPaused(state: MovementPlanState = readMovementPlan()): boolean {
  return state.symptomPauses.some((pause) => pause.resumedAt === null)
}

export function symptomCheckDue(state: MovementPlanState = readMovementPlan(), now = new Date()): boolean {
  if (isPlanPaused(state)) return false
  const anchor = state.lastSymptomCheckAt ?? currentWorksheet(state)?.completedAt ?? null
  if (!anchor) return false
  const last = new Date(anchor)
  if (Number.isNaN(last.getTime())) return true
  const due = addLocalDays(startOfLocalDay(last), SYMPTOM_CHECK_EVERY_DAYS)
  return startOfLocalDay(now).getTime() >= due.getTime()
}

export function answerSymptomCheck(gettingWorse: boolean, now = new Date()): MovementPlanState {
  const state = readMovementPlan()
  const at = now.toISOString()
  if (!gettingWorse || isPlanPaused(state)) {
    const next = { ...state, lastSymptomCheckAt: at }
    persist(next)
    return next
  }
  const next: MovementPlanState = {
    ...state,
    lastSymptomCheckAt: at,
    symptomPauses: [...state.symptomPauses, { pausedAt: at, resumedAt: null }],
  }
  persist(next)
  return next
}

export function resumeAfterProviderClearance(now = new Date()): MovementPlanState {
  const state = readMovementPlan()
  const open = state.symptomPauses.findIndex((pause) => pause.resumedAt === null)
  if (open < 0) return state
  const symptomPauses = state.symptomPauses.map((pause, index) =>
    index === open ? { ...pause, resumedAt: now.toISOString() } : pause,
  )
  const next = { ...state, symptomPauses }
  persist(next)
  return next
}

function stripExcludedMovements(state: MovementPlanState, now: Date): MovementPlanState {
  const excluded = new Set(excludedMovementIds(state.health, now))
  if (excluded.size === 0) return state
  const current = currentWorksheet(state)
  if (!current) return state
  const selectedIds = current.selectedIds.filter((id) => !excluded.has(id))
  if (selectedIds.length === current.selectedIds.length) return state
  const dropped = current.selectedIds.length > 0 && selectedIds.length === 0
  const record: WorksheetRecord = {
    ...current,
    selectedIds,
    rankedIds: current.rankedIds.filter((id) => !excluded.has(id)),
    suggestedIds: current.suggestedIds.filter((id) => !excluded.has(id)),
  }
  const history = state.history.map((item) => (item.id === record.id ? record : item))
  return {
    ...state,
    history,
    days: alignToday({ ...state, history }, selectedIds, now),
    worksheetRedoPrompt: state.worksheetRedoPrompt || dropped,
  }
}

function alignToday(state: MovementPlanState, selectedIds: readonly string[], now: Date): PlanDay[] {
  const day = localDayKeyFromDate(startOfLocalDay(now))
  const existing = state.days.find((entry) => entry.day === day)
  const checkedIds = selectedIds.filter((id) => existing?.checkedIds.includes(id))
  const complete = selectedIds.length > 0 && selectedIds.every((id) => checkedIds.includes(id))
  let exerciseLogId = existing?.exerciseLogId
  if (complete) {
    if (exerciseLogId) removeLog(exerciseLogId)
    exerciseLogId = writePlanExerciseLog(selectedIds, now)
  } else if (exerciseLogId) {
    removeLog(exerciseLogId)
    exerciseLogId = undefined
  }
  if (!existing && !exerciseLogId && checkedIds.length === 0) return state.days
  const progress: PlanDay = {
    day,
    checkedIds,
    ...(exerciseLogId ? { exerciseLogId } : {}),
  }
  return [progress, ...state.days.filter((entry) => entry.day !== day)].slice(0, DAY_LIMIT)
}

function writePlanExerciseLog(selectedIds: readonly string[], now: Date): string {
  const names = selectedIds.map((id) => movementName(id))
  const entry: ExerciseLog = {
    id: uid(),
    kind: 'exercise',
    at: now.toISOString(),
    activity: names.join(' · '),
    minutes: EVERYDAY_PLAN_MINUTES,
    felt: '',
  }
  addDiaryLog(entry)
  return entry.id
}

function dayWasCompleted(state: MovementPlanState, day: Date): boolean {
  const active = worksheetActiveOn(state, endOfLocalDay(day))
  if (!active || active.selectedIds.length === 0) return false
  const key = localDayKeyFromDate(day)
  const progress = state.days.find((entry) => entry.day === key)
  if (!progress) return false
  return active.selectedIds.every((id) => progress.checkedIds.includes(id))
}

function worksheetActiveOn(state: MovementPlanState, at: Date): WorksheetRecord | null {
  const time = at.getTime()
  let best: WorksheetRecord | null = null
  for (const record of state.history) {
    const completed = new Date(record.completedAt).getTime()
    if (Number.isNaN(completed) || completed > time) continue
    if (!best || completed > new Date(best.completedAt).getTime()) best = record
  }
  return best
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function normalizeReminderTime(value: string | null): string | null {
  if (!value) return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  return match ? `${match[1]}:${match[2]}` : null
}

function persist(state: MovementPlanState): void {
  writeJson(MOVEMENT_PLAN_STORAGE_KEY, state)
}

function sanitize(raw: unknown): MovementPlanState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE }
  const value = raw as Partial<MovementPlanState>
  const history = Array.isArray(value.history)
    ? value.history.map(sanitizeRecord).filter((record): record is WorksheetRecord => record !== null)
    : []
  const currentId =
    typeof value.currentId === 'string' && history.some((record) => record.id === value.currentId)
      ? value.currentId
      : (history[0]?.id ?? null)
  return {
    history,
    currentId,
    draft: sanitizeDraft(value.draft),
    days: sanitizeDays(value.days),
    reminderTime: normalizeReminderTime(typeof value.reminderTime === 'string' ? value.reminderTime : null),
    health: sanitizeHealth(value.health),
    symptomPauses: sanitizePauses(value.symptomPauses),
    lastSymptomCheckAt: typeof value.lastSymptomCheckAt === 'string' ? value.lastSymptomCheckAt : null,
    worksheetRedoPrompt: value.worksheetRedoPrompt === true,
    painRedoPrompt: value.painRedoPrompt === true,
  }
}

function sanitizeHealth(raw: unknown): HealthScreen | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<HealthScreen>
  if (value.osteoporosis !== 'yes' && value.osteoporosis !== 'no') return null
  if (value.hipReplacement !== 'yes' && value.hipReplacement !== 'no') return null
  if (value.pregnant !== 'yes' && value.pregnant !== 'no') return null
  const weeks =
    typeof value.weeksPregnant === 'number' && Number.isInteger(value.weeksPregnant) && value.weeksPregnant >= 0
      ? value.weeksPregnant
      : null
  const twelveWeekDate =
    typeof value.twelveWeekDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.twelveWeekDate)
      ? value.twelveWeekDate
      : null
  if (value.pregnant === 'yes' && (weeks === null || !twelveWeekDate)) return null
  return {
    osteoporosis: value.osteoporosis,
    hipReplacement: value.hipReplacement,
    pregnant: value.pregnant,
    weeksPregnant: value.pregnant === 'yes' ? weeks : null,
    twelveWeekDate: value.pregnant === 'yes' ? twelveWeekDate : null,
    answeredAt: typeof value.answeredAt === 'string' ? value.answeredAt : '',
  }
}

function sanitizePauses(raw: unknown): SymptomPause[] {
  if (!Array.isArray(raw)) return []
  const pauses: SymptomPause[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const pause = row as Partial<SymptomPause>
    if (typeof pause.pausedAt !== 'string' || !pause.pausedAt) continue
    pauses.push({
      pausedAt: pause.pausedAt,
      resumedAt: typeof pause.resumedAt === 'string' && pause.resumedAt ? pause.resumedAt : null,
    })
  }
  return pauses
}

function sanitizeRecord(raw: unknown): WorksheetRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<WorksheetRecord>
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.completedAt !== 'string' || !value.completedAt) return null
  if (!Array.isArray(value.answers)) return null
  const answers: MovementAnswers[] = []
  for (const answer of value.answers) {
    if (!answer || typeof answer !== 'object') return null
    const row = answer as Partial<MovementAnswers>
    if (typeof row.movementId !== 'string') return null
    if (row.pain !== 'yes' && row.pain !== 'no') return null
    if (row.regular !== 'yes' && row.regular !== 'no') return null
    if (row.contraction !== 0 && row.contraction !== 1 && row.contraction !== 2 && row.contraction !== 3) {
      return null
    }
    answers.push({
      movementId: row.movementId,
      pain: row.pain,
      regular: row.regular,
      contraction: row.contraction,
    })
  }
  const status = value.status === 'empty' ? 'empty' : value.status === 'plan' ? 'plan' : null
  if (!status) return null
  const strings = (ids: unknown): string[] =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  return {
    id: value.id,
    catalogId: value.catalogId === 'standard' ? 'standard' : STANDARD_MOVEMENT_CATALOG.id,
    completedAt: value.completedAt,
    answers,
    status,
    emptyReason: value.emptyReason === 'all-eliminated' || value.emptyReason === 'all-zero' ? value.emptyReason : undefined,
    rankedIds: strings(value.rankedIds),
    suggestedIds: strings(value.suggestedIds),
    selectedIds: strings(value.selectedIds),
  }
}

function sanitizeDraft(raw: unknown): DraftAnswer[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) return null
  const draft: DraftAnswer[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null
    const answer = row as Partial<DraftAnswer>
    if (typeof answer.movementId !== 'string') return null
    const pain = answer.pain === 'yes' || answer.pain === 'no' ? answer.pain : null
    const regular = answer.regular === 'yes' || answer.regular === 'no' ? answer.regular : null
    const contraction =
      answer.contraction === 0 || answer.contraction === 1 || answer.contraction === 2 || answer.contraction === 3
        ? answer.contraction
        : null
    draft.push({ movementId: answer.movementId, pain, regular, contraction })
  }
  return draft
}

function sanitizeDays(raw: unknown): PlanDay[] {
  if (!Array.isArray(raw)) return []
  const days: PlanDay[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const day = row as Partial<PlanDay>
    if (typeof day.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) continue
    const checkedIds = Array.isArray(day.checkedIds)
      ? day.checkedIds.filter((id): id is string => typeof id === 'string')
      : []
    days.push({
      day: day.day,
      checkedIds,
      ...(typeof day.exerciseLogId === 'string' && day.exerciseLogId ? { exerciseLogId: day.exerciseLogId } : {}),
    })
  }
  return days
}
