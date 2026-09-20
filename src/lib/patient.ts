import { nowIso, readJson, writeJson } from './storage.ts'
import type { PatientProfile } from './types.ts'

export const PATIENT_STORAGE_KEY = 'patient'
export const PATIENT_CHANGED_EVENT = 'sara-patient'

const MIN_BIRTH_YEAR = 1900
const MAX_AGE_YEARS = 130

export function readPatient(): PatientProfile | null {
  const raw = readJson<PatientProfile | null>(PATIENT_STORAGE_KEY, null)
  if (!patientProfileComplete(raw)) return null
  return raw
}

export function patientProfileComplete(
  profile: PatientProfile | null | undefined,
): profile is PatientProfile {
  return Boolean(
    profile &&
      normalizePatientName(profile.name) &&
      isValidDateOfBirth(profile.dateOfBirth),
  )
}

export function missingPatientFields(profile: PatientProfile | null | undefined): {
  name: boolean
  dateOfBirth: boolean
} {
  return {
    name: !normalizePatientName(profile?.name ?? ''),
    dateOfBirth: !isValidDateOfBirth(profile?.dateOfBirth ?? ''),
  }
}

export function normalizePatientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function isValidDateOfBirth(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return false
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (date > today) return false
  if (year < MIN_BIRTH_YEAR) return false
  const oldest = new Date()
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS)
  if (date < oldest) return false
  return true
}

export function formatDateOfBirth(ymd: string): string {
  if (!isValidDateOfBirth(ymd)) return ymd
  const [year, month, day] = ymd.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function savePatient(input: { name: string; dateOfBirth: string }): PatientProfile {
  const existing = readJson<PatientProfile | null>(PATIENT_STORAGE_KEY, null)
  const name = normalizePatientName(input.name)
  const dateOfBirth = input.dateOfBirth
  if (!name) throw new Error('Name is required')
  if (!isValidDateOfBirth(dateOfBirth)) throw new Error('Date of birth is required')
  const profile: PatientProfile = {
    name,
    dateOfBirth,
    savedAt: existing?.savedAt ?? nowIso(),
  }
  writeJson(PATIENT_STORAGE_KEY, profile)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PATIENT_CHANGED_EVENT))
  }
  return profile
}

export function patientFirstName(profile: PatientProfile | null | undefined): string | null {
  if (!profile) return null
  const piece = normalizePatientName(profile.name).split(' ')[0]
  return piece || null
}
