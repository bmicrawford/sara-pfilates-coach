import { activeDiary, finishDiary, startDiary } from './diary'
import { readJson, uid, writeJson, nowIso } from './storage'
import type { ChatMessage, DeviceBinding, Diary, LogEntry, Session } from './types'

export const DEMO_TOKEN = 'DEMO-SARA-001'

/**
 * KAJABI API: placeholder only.
 * After purchase, Kajabi would POST a webhook. A real backend would mint a
 * one-time redeem token, email `/r/:token`, and never share Kajabi SSO here.
 * This prototype does not call Kajabi.
 */

const VALID_TOKENS = new Set([DEMO_TOKEN])

export function normalizeToken(token: string): string {
  return token.trim().toUpperCase()
}

export function isKnownToken(token: string): boolean {
  return VALID_TOKENS.has(normalizeToken(token))
}

export function getOrCreateDeviceId(): string {
  const existing = readJson<string | null>('deviceId', null)
  if (existing) return existing
  const deviceId = uid()
  writeJson('deviceId', deviceId)
  return deviceId
}

function readBindings(): DeviceBinding[] {
  return readJson<DeviceBinding[]>('mock.bindings', [])
}

function writeBindings(bindings: DeviceBinding[]): void {
  writeJson('mock.bindings', bindings)
}

export function findBinding(token: string): DeviceBinding | undefined {
  const key = normalizeToken(token)
  return readBindings().find((b) => b.token === key)
}

export type RedeemResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'unknown-token' | 'bound-other-device'; binding?: DeviceBinding }

export function redeemToken(token: string, email: string): RedeemResult {
  const key = normalizeToken(token)
  if (!isKnownToken(key)) return { ok: false, reason: 'unknown-token' }

  const deviceId = getOrCreateDeviceId()
  const existing = findBinding(key)

  if (existing && existing.deviceId !== deviceId) {
    return { ok: false, reason: 'bound-other-device', binding: existing }
  }

  const binding: DeviceBinding = existing ?? {
    token: key,
    email: email.trim().toLowerCase(),
    deviceId,
    boundAt: nowIso(),
  }

  if (!existing) {
    writeBindings([...readBindings(), binding])
  }

  const session: Session = {
    email: existing?.email ?? binding.email,
    redeemToken: key,
    deviceId,
    redeemedAt: existing?.boundAt ?? binding.boundAt,
  }
  writeJson('session', session)
  notifySession()
  return { ok: true, session }
}

function notifySession(): void {
  window.dispatchEvent(new Event('sara-session'))
}

export function readSession(): Session | null {
  return readJson<Session | null>('session', null)
}

export function clearSession(): void {
  writeJson('session', null)
  notifySession()
}

/** Prototype helper: keep the mock bind, forget this browser as the phone. */
export function simulateNewPhone(): void {
  writeJson('deviceId', uid())
  clearSession()
}

export function releaseBinding(email: string): boolean {
  const want = email.trim().toLowerCase()
  const next = readBindings().filter((b) => b.email !== want)
  if (next.length === readBindings().length) return false
  writeBindings(next)
  const session = readSession()
  if (session && session.email === want) clearSession()
  return true
}

export function readLogs(): LogEntry[] {
  return readJson<LogEntry[]>('logs', [])
}

export function addLog(entry: LogEntry): LogEntry {
  const logs = [entry, ...readLogs()].slice(0, 200)
  writeJson('logs', logs)
  return entry
}

export function readDiaries(): Diary[] {
  return readJson<Diary[]>('diaries', [])
}

export function writeDiaries(diaries: Diary[]): void {
  writeJson('diaries', diaries)
}

export function startNewDiary(): Diary {
  const { diaries, diary } = startDiary(readDiaries(), nowIso(), uid())
  writeDiaries(diaries)
  return diary
}

export function finishActiveDiary(): Diary | null {
  const current = activeDiary(readDiaries())
  if (!current) return null
  const next = finishDiary(readDiaries(), current.id, nowIso())
  writeDiaries(next)
  return next.find((diary) => diary.id === current.id) ?? null
}

export function addDiaryLog(entry: LogEntry): LogEntry {
  const active = activeDiary(readDiaries())
  const tagged: LogEntry = active && !entry.diaryId ? { ...entry, diaryId: active.id } : entry
  return addLog(tagged)
}

export function readChat(): ChatMessage[] {
  return readJson<ChatMessage[]>('chat', [])
}

export function writeChat(messages: ChatMessage[]): void {
  writeJson('chat', messages)
}

export function touchOpened(): void {
  writeJson('lastOpenedAt', nowIso())
}

export function readLastOpened(): string | null {
  return readJson<string | null>('lastOpenedAt', null)
}
