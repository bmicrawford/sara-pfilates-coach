import type {
  Diary,
  DiaryViewStatus,
  ExerciseLog,
  LogEntry,
  LogKind,
  VoidLeakLog,
} from './types'

/** Existing Home event types — bladder diary uses the non-exercise kinds. */
export const BLADDER_LOG_KINDS: readonly LogKind[] = ['drink', 'voidLeak', 'pad']
export const EXERCISE_LOG_KIND: LogKind = 'exercise'

export const START_NEW_DIARY_LABEL = 'Start New Diary'

export const DIARY_ACTIVE_CUE =
  'Your diary is open. Record each drink, void, leak, pad change, and exercise in this diary while it is in progress.'

export const DIARY_STARTED_TOAST =
  'Diary started. Record events here as they happen. You can open the report while it is still in progress.'

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

export type BladderDiaryReport = {
  status: DiaryViewStatus
  startedAt: string
  completedAt?: string
  drinks: number
  voids: number
  leaks: number
  urges: number
  pads: number
  entries: LogEntry[]
}

export function bladderDiaryReport(diary: Diary, logs: LogEntry[]): BladderDiaryReport {
  const entries = bladderDiaryLogs(logsForDiary(diary, logs)).sort(byTimeDesc)
  const voidLeaks = entries.filter((log): log is VoidLeakLog => log.kind === 'voidLeak')
  return {
    status: diaryStatus(diary),
    startedAt: diary.startedAt,
    completedAt: diary.completedAt,
    drinks: entries.filter((log) => log.kind === 'drink').length,
    voids: voidLeaks.filter((log) => log.what === 'void').length,
    leaks: voidLeaks.filter((log) => log.what === 'leak').length,
    urges: voidLeaks.filter((log) => log.what === 'urge').length,
    pads: entries.filter((log) => log.kind === 'pad').length,
    entries,
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
