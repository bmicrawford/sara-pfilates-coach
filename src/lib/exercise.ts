import { exerciseLogs, localDayKey, parseMinutes, PATIENT_DOB_MISSING, PATIENT_NAME_MISSING } from './diary.ts'
import { isSameLocalDay, nowIso, readJson, writeJson } from './storage.ts'
import type { ExerciseLog, LogEntry, PatientProfile } from './types.ts'

export const EXERCISE_SPAN_DAYS = 28
export const EXERCISE_TARGET_WEEKS = 4
export const EXERCISE_DAILY_MINUTES = 5

export const EXERCISE_REPORT_TITLE = 'Exercise log'
export const EXERCISE_GATE_QUESTION =
  'Did you do pelvic floor exercise for at least 5 minutes daily for the last 4 weeks?'
export const EXERCISE_GATE_CONTINUE =
  'Keep logging your sessions. Continue the log — the completion PDF is ready when you can answer yes. You can try again next time you download.'
export const EXERCISE_MISSING_CUE =
  'No pelvic floor session logged today. A daily entry keeps your 4-week exercise log going.'
export const GENERATE_EXERCISE_LOG_LABEL = 'Generate exercise log'
export const EXERCISE_REPORT_EMPTY =
  'No sessions logged in the last 4 weeks. Log a session from Home when you do it.'
export const EXERCISE_CUE_DISMISS_LABEL = 'Got it'
export const EXERCISE_DURATION_LABEL = 'Duration'
export const EXERCISE_FREQUENCY_LABEL = 'Frequency'

export const EXERCISE_GATE_STORAGE_KEY = 'exerciseGate'
export const EXERCISE_CUE_STORAGE_KEY = 'exerciseCue'

export type ExerciseGateAnswer = 'yes' | 'no'

export type ExerciseGateState = {
  answer: ExerciseGateAnswer
  answeredAt: string
}

export type ExerciseCueState = {
  shownOn?: string
  dismissedOn?: string
}

export type ExerciseDayReport = {
  day: string
  sessions: number
  minutes: number
  items: ExerciseLog[]
}

export type FourWeekExerciseReport = {
  periodStart: string
  periodEnd: string
  spanDays: number
  minutes: number
  sessions: number
  daysExercised: number
  averageMinutesPerSession: number
  daysWithAtLeast5Minutes: number
  patientName: string
  dateOfBirth: string
  entries: ExerciseLog[]
  days: ExerciseDayReport[]
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function exercisePeriodBounds(now = new Date()): { start: Date; end: Date } {
  const end = startOfLocalDay(now)
  const start = addLocalDays(end, -(EXERCISE_SPAN_DAYS - 1))
  return { start, end }
}

export function isInExercisePeriod(iso: string, now = new Date()): boolean {
  const { start, end } = exercisePeriodBounds(now)
  const day = startOfLocalDay(new Date(iso)).getTime()
  return day >= start.getTime() && day <= end.getTime()
}

export function loggedExerciseOnLocalDay(logs: LogEntry[], day = new Date()): boolean {
  return exerciseLogs(logs).some((log) => isSameLocalDay(log.at, day))
}

export function fourWeekExerciseReport(
  logs: LogEntry[],
  options?: { now?: string; patient?: PatientProfile | null },
): FourWeekExerciseReport {
  const now = options?.now ? new Date(options.now) : new Date()
  const { start, end } = exercisePeriodBounds(now)
  const entries = exerciseLogs(logs)
    .filter((log) => isInExercisePeriod(log.at, now))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const byDay = new Map<string, ExerciseLog[]>()
  for (const entry of entries) {
    const day = localDayKey(entry.at)
    const items = byDay.get(day) ?? []
    items.push(entry)
    byDay.set(day, items)
  }

  const days: ExerciseDayReport[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, items]) => ({
      day,
      sessions: items.length,
      minutes: items.reduce((sum, log) => sum + parseMinutes(log.minutes), 0),
      items,
    }))

  const minutes = entries.reduce((sum, log) => sum + parseMinutes(log.minutes), 0)
  const sessions = entries.length
  const daysExercised = days.length
  const daysWithAtLeast5Minutes = days.filter((day) => day.minutes >= EXERCISE_DAILY_MINUTES).length

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    spanDays: EXERCISE_SPAN_DAYS,
    minutes,
    sessions,
    daysExercised,
    averageMinutesPerSession: sessions > 0 ? Math.round(minutes / sessions) : 0,
    daysWithAtLeast5Minutes,
    patientName: options?.patient?.name?.trim() || PATIENT_NAME_MISSING,
    dateOfBirth: options?.patient?.dateOfBirth || PATIENT_DOB_MISSING,
    entries,
    days,
  }
}

export function exerciseDurationLabel(report: FourWeekExerciseReport): string {
  return `${report.minutes} min`
}

export function exerciseFrequencyLabel(report: FourWeekExerciseReport): string {
  const sessionWord = report.sessions === 1 ? 'session' : 'sessions'
  return `${report.sessions} ${sessionWord} · ${report.daysExercised} of ${report.spanDays} days`
}

export function readExerciseGate(): ExerciseGateState | null {
  const raw = readJson<ExerciseGateState | null>(EXERCISE_GATE_STORAGE_KEY, null)
  if (!raw || (raw.answer !== 'yes' && raw.answer !== 'no') || !raw.answeredAt) return null
  return raw
}

export function writeExerciseGate(answer: ExerciseGateAnswer, at = nowIso()): ExerciseGateState {
  const next: ExerciseGateState = { answer, answeredAt: at }
  writeJson(EXERCISE_GATE_STORAGE_KEY, next)
  return next
}

/** Completion PDF is only generated after a Yes. No never unlocks export. */
export function canExportExerciseLogPdf(gate: ExerciseGateState | null | undefined): boolean {
  return gate?.answer === 'yes'
}

/** Re-ask on every download attempt until they answer Yes. */
export function shouldAskExerciseGate(gate: ExerciseGateState | null | undefined): boolean {
  return gate?.answer !== 'yes'
}

export function readExerciseCue(): ExerciseCueState {
  const raw = readJson<ExerciseCueState | null>(EXERCISE_CUE_STORAGE_KEY, null)
  return raw && typeof raw === 'object' ? raw : {}
}

export function writeExerciseCue(next: ExerciseCueState): ExerciseCueState {
  writeJson(EXERCISE_CUE_STORAGE_KEY, next)
  return next
}

export function shouldShowExerciseCue(
  logs: LogEntry[],
  cue: ExerciseCueState | null | undefined = readExerciseCue(),
  now = new Date(),
): boolean {
  if (loggedExerciseOnLocalDay(logs, now)) return false
  const today = localDayKey(now.toISOString())
  if (cue?.dismissedOn === today) return false
  return true
}

/** First Home visit of a missing day records the cue so it stays once-per-day, not a new toast each mount. */
export function markExerciseCueShown(now = new Date()): ExerciseCueState {
  const today = localDayKey(now.toISOString())
  const current = readExerciseCue()
  if (current.shownOn === today) return current
  return writeExerciseCue({ ...current, shownOn: today })
}

export function dismissExerciseCue(now = new Date()): ExerciseCueState {
  const today = localDayKey(now.toISOString())
  return writeExerciseCue({ ...readExerciseCue(), shownOn: today, dismissedOn: today })
}

export function exerciseCueAlreadyShownToday(
  cue: ExerciseCueState | null | undefined = readExerciseCue(),
  now = new Date(),
): boolean {
  return cue?.shownOn === localDayKey(now.toISOString())
}
