import type {
  Diary,
  DiaryViewStatus,
  ExerciseLog,
  LogEntry,
  LogKind,
  PatientProfile,
  VoidLeakLog,
} from './types.ts'

/** Existing Home event types — bladder diary uses the non-exercise kinds. */
export const BLADDER_LOG_KINDS: readonly LogKind[] = ['drink', 'voidLeak', 'pad']
export const EXERCISE_LOG_KIND: LogKind = 'exercise'

export const START_NEW_DIARY_LABEL = 'Start New Diary'

export const DIARY_ACTIVE_CUE =
  'Your diary is open. Record each drink, void, leak, pad change, and exercise in this diary while it is in progress. You can download the PDF before the diary is finished.'

export const DIARY_STARTED_TOAST =
  'Diary started. Record events here as they happen. You can download the PDF while it is still in progress.'

/** Clock and report days are 24-hour windows from the first logged event, not the Start New Diary tap. */
export const DIARY_DAY_MS = 24 * 60 * 60 * 1000
export const DIARY_SPAN_DAYS = 3
export const DIARY_DURATION_MS = DIARY_SPAN_DAYS * DIARY_DAY_MS
export const INCOMPLETE_DAY_LABEL = 'Incomplete'
export const PFILATES_BRAND = 'PfilAtes'
export const PFILATES_SITE = 'www.pfilates.com'
export const PATIENT_NAME_MISSING = 'Name not on file'
export const PATIENT_DOB_MISSING = 'Date of birth not on file'

export const BLADDER_TOTAL_FIELDS = [
  { key: 'drinks', label: 'Drinks' },
  { key: 'voids', label: 'Voids' },
  { key: 'leaks', label: 'Leaks' },
  { key: 'urges', label: 'Urges' },
  { key: 'pads', label: 'Pad changes' },
] as const

export type BladderTotalKey = (typeof BLADDER_TOTAL_FIELDS)[number]['key']
export type DiaryDayNumber = 1 | 2 | 3

export function isDiaryOpen(diary: Diary | null | undefined): diary is Diary {
  return Boolean(diary && !diary.completedAt)
}

export function diaryStatus(diary: Diary): DiaryViewStatus {
  return diary.completedAt ? 'completed' : 'in_progress'
}

export function activeDiary(diaries: Diary[]): Diary | null {
  return diaries.find((d) => !d.completedAt) ?? null
}

export function latestDiary(diaries: Diary[]): Diary | null {
  return activeDiary(diaries) ?? diaries[0] ?? null
}

export function startDiary(
  diaries: Diary[],
  now: string,
  id: string,
): { diaries: Diary[]; diary: Diary } {
  const existing = activeDiary(diaries)
  if (existing) return { diaries, diary: existing }
  const diary: Diary = { id, startedAt: now }
  return { diaries: [diary, ...diaries], diary }
}

export function finishDiary(diaries: Diary[], id: string, now: string): Diary[] {
  return diaries.map((diary) =>
    diary.id === id && !diary.completedAt ? { ...diary, completedAt: now } : diary,
  )
}

/** Stamp completedAt at T0+72h when the three-day window has elapsed. */
export function completeElapsedDiaries(diaries: Diary[], logs: LogEntry[], now: string): Diary[] {
  return diaries.map((diary) => {
    if (diary.completedAt) return diary
    const t0 = firstLoggedEventAt(logsForDiary(diary, logs))
    if (!t0 || !isThreeDayWindowComplete(t0, now)) return diary
    return { ...diary, completedAt: diaryCompletesAt(t0) }
  })
}

export function logsInDiaryWindow(diary: Diary, logs: LogEntry[]): LogEntry[] {
  const start = new Date(diary.startedAt).getTime()
  const end = diary.completedAt ? new Date(diary.completedAt).getTime() : Number.POSITIVE_INFINITY
  return logs.filter((log) => {
    const at = new Date(log.at).getTime()
    return at >= start && at <= end
  })
}

export function logsForDiary(diary: Diary, logs: LogEntry[]): LogEntry[] {
  const tagged = logs.filter((log) => log.diaryId === diary.id)
  if (tagged.length > 0) return tagged
  return logsInDiaryWindow(
    diary,
    logs.filter((log) => !log.diaryId),
  )
}

export function isBladderLog(log: LogEntry): boolean {
  return log.kind === 'drink' || log.kind === 'voidLeak' || log.kind === 'pad'
}

export function isExerciseLog(log: LogEntry): log is ExerciseLog {
  return log.kind === 'exercise'
}

export function bladderDiaryLogs(logs: LogEntry[]): LogEntry[] {
  return logs.filter(isBladderLog)
}

export function exerciseLogs(logs: LogEntry[]): ExerciseLog[] {
  return logs.filter(isExerciseLog)
}

export function canViewDiaryReport(diary: Diary | null): diary is Diary {
  return Boolean(diary)
}

export type BladderTotals = {
  drinks: number
  voids: number
  leaks: number
  urges: number
  pads: number
}

export type DiaryDayReport = BladderTotals & {
  day: DiaryDayNumber
  label: string
  complete: boolean
  incomplete: boolean
  empty: boolean
}

export type BladderDiaryReport = BladderTotals & {
  status: DiaryViewStatus
  startedAt: string
  firstEventAt: string | null
  completedAt?: string
  days: DiaryDayReport[]
  patientName: string
  dateOfBirth: string
  entries: LogEntry[]
}

export function emptyBladderTotals(): BladderTotals {
  return { drinks: 0, voids: 0, leaks: 0, urges: 0, pads: 0 }
}

export function countBladderTotals(entries: LogEntry[]): BladderTotals {
  const voidLeaks = entries.filter((log): log is VoidLeakLog => log.kind === 'voidLeak')
  return {
    drinks: entries.filter((log) => log.kind === 'drink').length,
    voids: voidLeaks.filter((log) => log.what === 'void').length,
    leaks: voidLeaks.filter((log) => log.what === 'leak').length,
    urges: voidLeaks.filter((log) => log.what === 'urge').length,
    pads: entries.filter((log) => log.kind === 'pad').length,
  }
}

export function firstLoggedEventAt(logs: LogEntry[]): string | null {
  if (logs.length === 0) return null
  let earliest = logs[0].at
  for (const log of logs) {
    if (new Date(log.at).getTime() < new Date(earliest).getTime()) earliest = log.at
  }
  return earliest
}

export function diaryDayNumber(at: string, t0: string): DiaryDayNumber | null {
  const delta = new Date(at).getTime() - new Date(t0).getTime()
  if (delta < 0) return null
  const day = Math.floor(delta / DIARY_DAY_MS) + 1
  if (day < 1 || day > DIARY_SPAN_DAYS) return null
  return day as DiaryDayNumber
}

export function diaryDayEndsAt(t0: string, day: DiaryDayNumber): string {
  return new Date(new Date(t0).getTime() + day * DIARY_DAY_MS).toISOString()
}

export function diaryCompletesAt(t0: string): string {
  return diaryDayEndsAt(t0, DIARY_SPAN_DAYS)
}

export function isDiaryDayComplete(t0: string | null, day: DiaryDayNumber, asOf: string): boolean {
  if (!t0) return false
  return new Date(asOf).getTime() >= new Date(diaryDayEndsAt(t0, day)).getTime()
}

export function isThreeDayWindowComplete(t0: string | null, asOf: string): boolean {
  return isDiaryDayComplete(t0, DIARY_SPAN_DAYS, asOf)
}

export function reportAsOf(diary: Diary, now: string): string {
  return diary.completedAt ?? now
}

export function buildDiaryDays(
  bladderEntries: LogEntry[],
  t0: string | null,
  asOf: string,
): DiaryDayReport[] {
  const buckets: LogEntry[][] = [[], [], []]
  if (t0) {
    for (const entry of bladderEntries) {
      const day = diaryDayNumber(entry.at, t0)
      if (day) buckets[day - 1].push(entry)
    }
  }
  return ([1, 2, 3] as const).map((day) => {
    const totals = countBladderTotals(buckets[day - 1])
    const complete = isDiaryDayComplete(t0, day, asOf)
    return {
      day,
      label: `Day ${day}`,
      complete,
      incomplete: !complete,
      empty: buckets[day - 1].length === 0,
      ...totals,
    }
  })
}

export function bladderDiaryReport(
  diary: Diary,
  logs: LogEntry[],
  options?: { now?: string; patient?: PatientProfile | null },
): BladderDiaryReport {
  const now = options?.now ?? new Date().toISOString()
  const diaryLogs = logsForDiary(diary, logs)
  const firstEventAt = firstLoggedEventAt(diaryLogs)
  const asOf = reportAsOf(diary, now)
  const completedByClock = isThreeDayWindowComplete(firstEventAt, now)
  const entries = bladderDiaryLogs(diaryLogs)
    .filter((entry) => (firstEventAt ? diaryDayNumber(entry.at, firstEventAt) !== null : false))
    .sort(byTimeDesc)
  const days = buildDiaryDays(entries, firstEventAt, asOf)
  const totals = countBladderTotals(entries)
  return {
    status: diary.completedAt || completedByClock ? 'completed' : 'in_progress',
    startedAt: diary.startedAt,
    firstEventAt,
    completedAt: diary.completedAt ?? (completedByClock && firstEventAt ? diaryCompletesAt(firstEventAt) : undefined),
    days,
    patientName: options?.patient?.name?.trim() || PATIENT_NAME_MISSING,
    dateOfBirth: options?.patient?.dateOfBirth || PATIENT_DOB_MISSING,
    entries,
    ...totals,
  }
}

export type ExerciseLogReport = {
  status: DiaryViewStatus
  startedAt: string
  completedAt?: string
  sessions: number
  minutes: number
  entries: ExerciseLog[]
}

export function exerciseLogReport(diary: Diary, logs: LogEntry[]): ExerciseLogReport {
  const entries = exerciseLogs(logsForDiary(diary, logs)).sort(byTimeDesc)
  return {
    status: diaryStatus(diary),
    startedAt: diary.startedAt,
    completedAt: diary.completedAt,
    sessions: entries.length,
    minutes: entries.reduce((sum, log) => sum + parseMinutes(log.minutes), 0),
    entries,
  }
}

export function parseMinutes(value: string): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function localDayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function groupLogsByDay<T extends LogEntry>(logs: T[]): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const log of logs) {
    const day = localDayKey(log.at)
    const items = map.get(day) ?? []
    items.push(log)
    map.set(day, items)
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }))
}

export function summarizeLog(entry: LogEntry): string {
  if (entry.kind === 'drink') return `${entry.beverage} · ${entry.amount}`
  if (entry.kind === 'voidLeak') return `${labelWhat(entry.what)} · ${entry.intensity}`
  if (entry.kind === 'pad') return `Pad · ${entry.reason}`
  return `${entry.activity} · ${entry.minutes} min`
}

export function labelWhat(what: 'void' | 'leak' | 'urge'): string {
  if (what === 'void') return 'Void'
  if (what === 'leak') return 'Leak'
  return 'Urge'
}

function byTimeDesc(a: LogEntry, b: LogEntry): number {
  return new Date(b.at).getTime() - new Date(a.at).getTime()
}
