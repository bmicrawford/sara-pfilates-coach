import { readJson, removeKey, writeJson } from './storage.ts'

/** localStorage key `sara.installCoach`. Cleared with the session on New phone. */
export const INSTALL_COACH_STORAGE_KEY = 'installCoach'

export type InstallCoachStatus = 'pending' | 'dismissed' | 'installed'

const STATUSES = new Set<InstallCoachStatus>(['pending', 'dismissed', 'installed'])

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredInstall: BeforeInstallPromptEvent | null = null
let capturingInstallPrompt = false
const installPromptListeners = new Set<() => void>()

export function readInstallCoachStatus(): InstallCoachStatus | null {
  const value = readJson<unknown>(INSTALL_COACH_STORAGE_KEY, null)
  return typeof value === 'string' && STATUSES.has(value as InstallCoachStatus)
    ? (value as InstallCoachStatus)
    : null
}

export function isIosUserAgent(ua: string, platform = '', maxTouchPoints = 0): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true
  // iPadOS 13+ Safari uses a desktop Macintosh user agent.
  return platform === 'MacIntel' && maxTouchPoints > 1
}

export function displayModeIsStandalone(
  matchMediaStandalone: boolean,
  navigatorStandalone: boolean,
): boolean {
  return matchMediaStandalone || navigatorStandalone
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return isIosUserAgent(
    navigator.userAgent || '',
    navigator.platform || '',
    navigator.maxTouchPoints || 0,
  )
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const matchMediaStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches === true
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return displayModeIsStandalone(matchMediaStandalone, nav?.standalone === true)
}

export function shouldShowInstallCoach(): boolean {
  if (isStandalone()) return false
  return readInstallCoachStatus() === 'pending'
}

/** After a successful redeem. Leaves a remembered dismiss or install alone. */
export function armInstallCoach(standalone = isStandalone()): void {
  if (standalone) return
  const status = readInstallCoachStatus()
  if (status === 'dismissed' || status === 'installed') return
  writeJson(INSTALL_COACH_STORAGE_KEY, 'pending' satisfies InstallCoachStatus)
}

export function dismissInstallCoach(): void {
  writeJson(INSTALL_COACH_STORAGE_KEY, 'dismissed' satisfies InstallCoachStatus)
}

export function markInstallCoachInstalled(): void {
  writeJson(INSTALL_COACH_STORAGE_KEY, 'installed' satisfies InstallCoachStatus)
}

export function clearInstallCoach(): void {
  removeKey(INSTALL_COACH_STORAGE_KEY)
}

/** Opening the installed app counts as a successful install for this phone. */
export function noteStandaloneInstall(): void {
  if (!isStandalone()) return
  if (readInstallCoachStatus() === 'pending') markInstallCoachInstalled()
}

function emitInstallPrompt(): void {
  installPromptListeners.forEach((listener) => listener())
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstall
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  installPromptListeners.add(listener)
  return () => {
    installPromptListeners.delete(listener)
  }
}

/** Catch `beforeinstallprompt` before Home mounts (onboarding can sit in front). */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return
  const host = window as Window & { __saraCaptureInstallPrompt?: boolean }
  if (capturingInstallPrompt || host.__saraCaptureInstallPrompt) return
  capturingInstallPrompt = true
  host.__saraCaptureInstallPrompt = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredInstall = event as BeforeInstallPromptEvent
    emitInstallPrompt()
  })
  window.addEventListener('appinstalled', () => {
    deferredInstall = null
    try {
      markInstallCoachInstalled()
    } catch {
      // The coach is optional. Redeem already succeeded.
    }
    emitInstallPrompt()
  })
}

export async function runInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredInstall
  if (!event) return 'unavailable'
  deferredInstall = null
  emitInstallPrompt()
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') {
      markInstallCoachInstalled()
      return 'accepted'
    }
    dismissInstallCoach()
    return 'dismissed'
  } catch {
    return 'unavailable'
  }
}
