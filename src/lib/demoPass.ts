import { DEMO_TOKEN, readSession } from './mockServer.ts'

/** True only for the public / QA demo pass. Class and purchase passes are false. */
export function isDemoPass(token: string | null | undefined): boolean {
  return String(token ?? '').trim().toUpperCase() === DEMO_TOKEN
}

/** Demo chats stay on the still portrait plus ara. They must not open D-ID. */
export function isDemoVoiceOnly(token: string | null | undefined): boolean {
  return isDemoPass(token)
}

export function currentSaraPass(): string {
  return readSession()?.redeemToken ?? ''
}

/** Drop name and date of birth before a demo PDF or on-screen report. */
export function reportForViewer<T extends { patientName: string; dateOfBirth: string }>(
  report: T,
  demo: boolean,
): T {
  if (!demo) return report
  return { ...report, patientName: '', dateOfBirth: '' }
}
