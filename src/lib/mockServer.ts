import { activeDiary, completeElapsedDiaries, finishDiary, startDiary } from './diary'
import { readJson, uid, writeJson, nowIso } from './storage'
import type { ChatMessage, DeviceBinding, Diary, LogEntry, Session } from './types'

export const DEMO_TOKEN = 'DEMO-SARA-001'

/**
 * QA pass stays in this browser. Purchased passes are minted on the Worker
 * (`POST /redeem/mint`) and checked with `POST /redeem` before this phone binds.
 * Kajabi keeps the course. The mint secret never lives in this file.
 */

const VALID_TOKENS = new Set([DEMO_TOKEN])
const REDEEM_TIMEOUT_MS = 12_000

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
  | {
      ok: false
      reason: 'unknown-token' | 'bound-other-device' | 'email-mismatch' | 'redeem-unavailable' | 'invalid'
      binding?: DeviceBinding
    }

function saraApiBase(): string {
  return (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
}

type RemoteRedeem =
  | { ok: true }
  | { ok: false; reason: 'unknown-token' | 'email-mismatch' | 'redeem-unavailable' | 'invalid' }

async function confirmRemotePass(token: string, email: string): Promise<RemoteRedeem> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), REDEEM_TIMEOUT_MS)
  try {
    const res = await fetch(`${saraApiBase()}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ token, email }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string }
    if (res.ok && data.ok) return { ok: true }
    if (data.reason === 'unknown-token' || res.status === 404) return { ok: false, reason: 'unknown-token' }
    if (data.reason === 'email-mismatch' || res.status === 409) return { ok: false, reason: 'email-mismatch' }
    if (data.reason === 'invalid' || res.status === 400) return { ok: false, reason: 'invalid' }
    return { ok: false, reason: 'redeem-unavailable' }
  } catch {
    return { ok: false, reason: 'redeem-unavailable' }
  } finally {
    window.clearTimeout(timer)
  }
}

function bindRedeemedToken(key: string, email: string): RedeemResult {
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

export async function redeemToken(token: string, email: string): Promise<RedeemResult> {
  const key = normalizeToken(token)
  if (!key) return { ok: false, reason: 'unknown-token' }
  if (!isKnownToken(key)) {
    const remote = await confirmRemotePass(key, email)
    if (!remote.ok) return remote
  }
  return bindRedeemedToken(key, email)
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

/** Close any open diary whose first logged event was 72 hours ago. */
export function syncDiaryWindows(now = nowIso()): Diary[] {
  const next = completeElapsedDiaries(readDiaries(), readLogs(), now)
  writeDiaries(next)
  return next
}

export function startNewDiary(): Diary {
  syncDiaryWindows()
  const { diaries, diary } = startDiary(readDiaries(), nowIso(), uid())
  writeDiaries(diaries)
  return diary
}

export function finishActiveDiary(): Diary | null {
  syncDiaryWindows()
  const current = activeDiary(readDiaries())
  if (!current) return null
  const next = finishDiary(readDiaries(), current.id, nowIso())
  writeDiaries(next)
  return next.find((diary) => diary.id === current.id) ?? null
}

export function addDiaryLog(entry: LogEntry): LogEntry {
  syncDiaryWindows()
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
