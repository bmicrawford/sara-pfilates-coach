import { addLocalDays, EXERCISE_DAILY_MINUTES, localDayKeyFromDate, startOfLocalDay } from './exercise.ts'
import { addDiaryLog, readLogs, removeLog } from './mockServer.ts'
import {
  COURSE_LINE,
  STANDARD_MOVEMENT_CATALOG,
  adjustTopMovements,
  movementName,
  selectTopMovements,
  type ContractionRating,
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

export type MovementPlanState = {
  history: WorksheetRecord[]
  currentId: string | null
  draft: DraftAnswer[] | null
  days: PlanDay[]
  /** `HH:MM` 24-hour preference. Not a live notification. */
  reminderTime: string | null
}

const EMPTY_STATE: MovementPlanState = {
  history: [],
  currentId: null,
  draft: null,
  days: [],
  reminderTime: null,
}

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

export function completeAnswers(draft: readonly DraftAnswer[]): MovementAnswers[] | null {
  if (draft.length !== STANDARD_MOVEMENT_CATALOG.movements.length) return null
  const out: MovementAnswers[] = []
  for (const row of draft) {
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
  const ids = new Set(out.map((answer) => answer.movementId))
  if (!STANDARD_MOVEMENT_CATALOG.movements.every((movement) => ids.has(movement.id))) return null
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
  const names = everydayMovementNames(state)
  if (names.length === 0) return ''
  return `The person's current everyday movements, chosen on their Movement Selection Worksheet, are: ${names.join('; ')}. ${COURSE_LINE} They are done as taught in the PfilAtes course on Kajabi. Do not invent exercise instructions, and do not suggest movements they did not choose.`
}

export function saveWorksheetResult(
  answers: readonly MovementAnswers[],
  chosenIds: readonly string[],
  now = new Date(),
): { ok: true; state: MovementPlanState } | { ok: false; reason: 'incomplete' | 'selection' } {
  const answeredIds = new Set(answers.map((answer) => answer.movementId))
  if (!STANDARD_MOVEMENT_CATALOG.movements.every((movement) => answeredIds.has(movement.id))) {
    return { ok: false, reason: 'incomplete' }
  }

  const selection = selectTopMovements(STANDARD_MOVEMENT_CATALOG, answers)
  let selectedIds: string[] = []
  if (selection.status === 'plan') {
    const adjusted = adjustTopMovements(selection.rankedIds, chosenIds)
    if (!adjusted) return { ok: false, reason: 'selection' }
    selectedIds = adjusted
  }

  const state = readMovementPlan()
  const today = localDayKeyFromDate(startOfLocalDay(now))
  const todayProgress = state.days.find((day) => day.day === today)
  if (todayProgress?.exerciseLogId) removeLog(todayProgress.exerciseLogId)

  const record: WorksheetRecord = {
    id: uid(),
    catalogId: STANDARD_MOVEMENT_CATALOG.id,
    completedAt: now.toISOString(),
    answers: answers.map((answer) => ({ ...answer })),
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
  }
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
