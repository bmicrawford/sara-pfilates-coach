export type Mood = 'default' | 'neutral' | 'listening' | 'talking' | 'celebrate'

export type Session = {
  email: string
  redeemToken: string
  deviceId: string
  redeemedAt: string
}

/** Durable on-device patient label for the doctor report. Never invent these. */
export type PatientProfile = {
  name: string
  dateOfBirth: string
  savedAt: string
}

export type DeviceBinding = {
  token: string
  email: string
  deviceId: string
  boundAt: string
}

export type LogKind = 'drink' | 'voidLeak' | 'pad' | 'exercise'

export type DrinkLog = {
  id: string
  kind: 'drink'
  at: string
  diaryId?: string
  beverage: string
  amount: string
  note?: string
}

export type VoidLeakLog = {
  id: string
  kind: 'voidLeak'
  at: string
  diaryId?: string
  what: 'void' | 'leak' | 'urge'
  intensity: string
  note?: string
}

export type PadLog = {
  id: string
  kind: 'pad'
  at: string
  diaryId?: string
  reason: string
}

export type ExerciseLog = {
  id: string
  kind: 'exercise'
  at: string
  diaryId?: string
  activity: string
  minutes: string
  felt: string
}

export type LogEntry = DrinkLog | VoidLeakLog | PadLog | ExerciseLog

export type Diary = {
  id: string
  startedAt: string
  completedAt?: string
}

export type DiaryViewStatus = 'in_progress' | 'completed'

export type ChatMessage = {
  id: string
  from: 'you' | 'sara'
  text: string
  at: string
}

export type SheetId = 'drink' | 'voidLeak' | 'pad' | 'exercise' | null
