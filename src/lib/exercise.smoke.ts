import { readFileSync } from 'node:fs'
import { PFILATES_BRAND, PFILATES_SITE, exerciseLogReport } from './diary.ts'
import {
  EXERCISE_ATTESTED_ITEM_LABEL,
  EXERCISE_ATTESTED_NOTE,
  EXERCISE_ATTESTED_TIME_LABEL,
  EXERCISE_CUE_DISMISS_LABEL,
  EXERCISE_DAILY_MINUTES,
  EXERCISE_DURATION_LABEL,
  EXERCISE_FREQUENCY_LABEL,
  EXERCISE_GATE_CONTINUE,
  EXERCISE_GATE_QUESTION,
  EXERCISE_MISSING_CUE,
  EXERCISE_SPAN_DAYS,
  EXERCISE_TARGET_WEEKS,
  GENERATE_EXERCISE_LOG_LABEL,
  canExportExerciseLogPdf,
  dismissExerciseCue,
  exerciseCueAlreadyShownToday,
  exerciseDayLines,
  exerciseDurationLabel,
  exerciseFrequencyLabel,
  fourWeekExerciseReport,
  isInExercisePeriod,
  loggedExerciseOnLocalDay,
  markExerciseCueShown,
  readExerciseCue,
  readExerciseGate,
  shouldAskExerciseGate,
  shouldImputeAttestedExerciseDays,
  shouldShowExerciseCue,
  writeExerciseGate,
} from './exercise.ts'
import {
  buildExerciseLogPdf,
  canBuildExerciseLogPdf,
  exerciseLogPdfDoc,
  exerciseLogPdfFilename,
  exerciseLogPdfPlainText,
} from './exercisePdf.ts'
import type { Diary, LogEntry, PatientProfile } from './types.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

const memory = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
} as Storage

const now = new Date(2026, 8, 20, 18, 0, 0)
const nowIso = now.toISOString()
const patient: PatientProfile = {
  name: 'Alex Rivera',
  dateOfBirth: '1978-03-15',
  savedAt: '2026-09-01T12:00:00.000Z',
}

const todaySession: LogEntry = {
  id: 'e-today',
  kind: 'exercise',
  at: new Date(2026, 8, 20, 9, 0, 0).toISOString(),
  activity: 'PfilAtes',
  minutes: '10',
  felt: 'Just right',
}
const lastWeekSession: LogEntry = {
  id: 'e-week',
  kind: 'exercise',
  at: new Date(2026, 8, 13, 9, 0, 0).toISOString(),
  activity: 'Pelvic floor',
  minutes: '8',
  felt: 'Easy',
}
const oldSession: LogEntry = {
  id: 'e-old',
  kind: 'exercise',
  at: new Date(2026, 7, 20, 9, 0, 0).toISOString(),
  activity: 'PfilAtes',
  minutes: '20',
  felt: 'Just right',
}
const drink: LogEntry = {
  id: 'd1',
  kind: 'drink',
  at: new Date(2026, 8, 20, 10, 0, 0).toISOString(),
  beverage: 'Water',
  amount: 'Glass',
}

const logs: LogEntry[] = [todaySession, lastWeekSession, oldSession, drink]
const report = fourWeekExerciseReport(logs, { now: nowIso, patient })

assert(EXERCISE_SPAN_DAYS === 28 && EXERCISE_TARGET_WEEKS === 4, 'target period is 4 weeks / 28 days')
assert(EXERCISE_DAILY_MINUTES === 5, 'daily target named in the gate is 5 minutes')
assert(
  EXERCISE_GATE_QUESTION ===
    'Did you do pelvic floor exercise for at least 5 minutes daily for the last 4 weeks?',
  'gate question is exact',
)
assert(/continue the log/i.test(EXERCISE_GATE_CONTINUE), 'No path tells them to continue the log')
assert(/try again next time/i.test(EXERCISE_GATE_CONTINUE), 'No path says they can try download again')
assert(!/cure|treat|diagnos|clinician promise/i.test(EXERCISE_GATE_QUESTION), 'gate makes no new medical claim')
assert(!/cure|treat|diagnos|clinician promise/i.test(EXERCISE_MISSING_CUE), 'daily cue makes no new medical claim')
assert(/no pelvic floor session logged today/i.test(EXERCISE_MISSING_CUE), 'cue names the missing daily entry')
assert(EXERCISE_DURATION_LABEL === 'Duration' && EXERCISE_FREQUENCY_LABEL === 'Frequency', 'report labels are duration and frequency')

assert(report.spanDays === 28, '4-week report spans 28 local days')
assert(report.minutes === 18, 'duration sums minutes in the 4-week window')
assert(report.sessions === 2, 'frequency counts sessions in the 4-week window')
assert(report.daysExercised === 2, 'frequency also counts days with a session')
assert(report.attestedBlankDays === 0 && !report.imputed, 'unanswered gate does not fill blank days')
assert(!report.entries.some((entry) => entry.id === 'e-old'), 'sessions older than 4 weeks are outside the period')
assert(!report.entries.some((entry) => entry.kind !== 'exercise'), 'report uses the existing exercise event schema only')
assert(report.patientName === 'Alex Rivera', 'report uses the diary patient store name')
assert(report.dateOfBirth === '1978-03-15', 'report uses the diary patient store DOB')
assert(exerciseDurationLabel(report) === '18 min', 'duration label is minutes')
assert(exerciseFrequencyLabel(report) === '2 sessions · 2 of 28 days', 'frequency label is sessions and days')
assert(isInExercisePeriod(todaySession.at, now), 'today is inside the 4-week window')
assert(!isInExercisePeriod(oldSession.at, now), 'a session 31 days ago is outside the window')
assert(loggedExerciseOnLocalDay(logs, now), 'today has a logged exercise entry')
assert(!loggedExerciseOnLocalDay([lastWeekSession], now), 'missing today is detected from the existing schema')

const open: Diary = { id: 'open', startedAt: '2026-09-20T13:00:00.000Z' }
const diaryScoped = exerciseLogReport(open, [
  { ...todaySession, diaryId: 'open' },
  { ...lastWeekSession, diaryId: 'open' },
])
assert(diaryScoped.sessions === 2 && diaryScoped.minutes === 18, 'existing diary-scoped exercise helper is unchanged')

assert(shouldAskExerciseGate(null), 'first download attempt asks the gate')
assert(!canExportExerciseLogPdf(null), 'PDF is not generated before an answer')
const noAnswer = writeExerciseGate('no', nowIso)
assert(noAnswer.answer === 'no', 'last No is persisted for the continue-log message')
assert(shouldAskExerciseGate(noAnswer), 'after No, the next download attempt asks again')
assert(!canExportExerciseLogPdf(noAnswer), 'No does not generate the completion PDF')
assert(!canBuildExerciseLogPdf(report, noAnswer), 'build path stays closed after No')
assert(readExerciseGate()?.answer === 'no', 'No is readable back from the patient store')
assert(!shouldImputeAttestedExerciseDays(noAnswer), 'No does not impute blank days')
const noReport = fourWeekExerciseReport(logs, { now: nowIso, patient, gate: noAnswer })
assert(noReport.minutes === 18 && noReport.sessions === 2 && noReport.daysExercised === 2, 'No leaves duration and frequency as logged only')
assert(noReport.attestedBlankDays === 0 && !noReport.imputed, 'No does not add attested blank days')
assert(noReport.days.every((day) => day.source === 'logged'), 'No report lists only logged days')
const noAgain = writeExerciseGate('no', nowIso)
assert(shouldAskExerciseGate(noAgain) && !canExportExerciseLogPdf(noAgain), 'a second No still continues the log')
const yesAnswer = writeExerciseGate('yes', nowIso)
assert(!shouldAskExerciseGate(yesAnswer), 'after Yes, download does not re-ask')
assert(canExportExerciseLogPdf(yesAnswer), 'Yes unlocks the completion PDF')
assert(canBuildExerciseLogPdf(report, yesAnswer), 'Yes can build the branded exercise log')
assert(shouldImputeAttestedExerciseDays(yesAnswer), 'Yes imputes blank days at report time')

const yesReport = fourWeekExerciseReport(logs, { now: nowIso, patient, gate: yesAnswer })
assert(yesReport.days.length === 28, 'Yes report includes every calendar day in the 4-week window')
assert(yesReport.attestedBlankDays === 26, 'Yes fills each day with no exercise entry')
assert(yesReport.imputed, 'Yes marks the report as attested-fill')
assert(yesReport.minutes === 18 + 26 * EXERCISE_DAILY_MINUTES, 'Yes adds 5 minutes for each blank day to duration')
assert(yesReport.sessions === 28, 'Yes counts one attested session per blank day plus logged sessions')
assert(yesReport.daysExercised === 28, 'Yes counts blank days toward frequency days')
assert(exerciseDurationLabel(yesReport) === '148 min', 'Yes duration label includes attested minutes')
assert(exerciseFrequencyLabel(yesReport) === '28 sessions · 28 of 28 days', 'Yes frequency includes attested days')
assert(
  yesReport.entries.map((entry) => entry.id).join(',') === 'e-today,e-week',
  'Yes does not invent stored exercise entries for blank days',
)
const todayDay = yesReport.days.find((day) => day.items.some((item) => item.id === 'e-today'))
const weekDay = yesReport.days.find((day) => day.items.some((item) => item.id === 'e-week'))
assert(todayDay?.source === 'logged' && todayDay.minutes === 10, 'Yes keeps the logged 10-minute day')
assert(weekDay?.source === 'logged' && weekDay.minutes === 8, 'Yes keeps the logged 8-minute day')
assert(
  yesReport.days.filter((day) => day.source === 'attested').every((day) => day.minutes === 5 && day.sessions === 1 && day.items.length === 0),
  'attested blank days are 5 min pelvic floor with no fake stored items',
)
assert(
  exerciseDayLines(yesReport.days.find((day) => day.source === 'attested')!).some(
    (line) => line.time === EXERCISE_ATTESTED_TIME_LABEL && line.text === EXERCISE_ATTESTED_ITEM_LABEL,
  ),
  'attested days use the per-patient-confirmation label',
)

const shortSession: LogEntry = {
  id: 'e-short',
  kind: 'exercise',
  at: new Date(2026, 8, 15, 9, 0, 0).toISOString(),
  activity: 'Walk',
  minutes: '3',
  felt: 'Easy',
}
const yesWithShort = fourWeekExerciseReport([...logs, shortSession], { now: nowIso, patient, gate: yesAnswer })
const shortDay = yesWithShort.days.find((day) => day.items.some((item) => item.id === 'e-short'))
assert(shortDay?.source === 'logged' && shortDay.minutes === 3, 'a logged day under 5 minutes is not overwritten with 5')
assert(yesWithShort.minutes === 21 + 25 * EXERCISE_DAILY_MINUTES, 'short logged day keeps 3 minutes and other blanks still fill')
assert(yesWithShort.attestedBlankDays === 25, 'a logged short day is not treated as blank')

const emptyYes = fourWeekExerciseReport([], { now: nowIso, patient, gate: yesAnswer })
assert(emptyYes.minutes === 28 * EXERCISE_DAILY_MINUTES && emptyYes.attestedBlankDays === 28, 'Yes with no logs fills every day as 5 min')
assert(emptyYes.entries.length === 0, 'empty Yes report still has no stored sessions')
assert(emptyYes.days.every((day) => day.source === 'attested'), 'empty Yes report days are all attested')

const emptyLogs: LogEntry[] = []
assert(shouldShowExerciseCue(emptyLogs, {}, now), 'missing daily entry shows the Home cue')
assert(!shouldShowExerciseCue(logs, {}, now), 'a session today suppresses the cue')
assert(
  !shouldShowExerciseCue(emptyLogs, { dismissedOn: '2026-09-20' }, now),
  'dismissing the cue hides it for the rest of that day',
)
assert(
  shouldShowExerciseCue(emptyLogs, { dismissedOn: '2026-09-19', shownOn: '2026-09-19' }, now),
  'yesterday’s dismiss does not suppress today’s missing-day cue',
)
markExerciseCueShown(now)
assert(exerciseCueAlreadyShownToday(readExerciseCue(), now), 'first show of the day is recorded so it is not a new toast each mount')
dismissExerciseCue(now)
assert(!shouldShowExerciseCue(emptyLogs, readExerciseCue(), now), 'Got it dismisses the banner for today only')
assert(EXERCISE_CUE_DISMISS_LABEL === 'Got it', 'dismiss control stays short for a phone banner')

const pdfDoc = exerciseLogPdfDoc(report)
const pdfText = exerciseLogPdfPlainText(pdfDoc)
assert(pdfDoc.title === 'Exercise log', 'PDF title matches the report screen')
assert(pdfDoc.brand === PFILATES_BRAND && pdfDoc.site === PFILATES_SITE, 'PDF header uses PfilAtes and www.pfilates.com')
assert(pdfDoc.patientName === 'Alex Rivera', 'PDF includes the patient name')
assert(pdfText.includes('Date of birth:'), 'PDF includes the date of birth label')
assert(pdfDoc.stats[0]?.label === 'Duration' && pdfDoc.stats[0]?.value === '18 min', 'PDF duration matches the on-screen summary')
assert(
  pdfDoc.stats[1]?.label === 'Frequency' && pdfDoc.stats[1]?.value === '2 sessions · 2 of 28 days',
  'PDF frequency matches the on-screen summary',
)
assert(!pdfDoc.attestedNote, 'logged-only PDF has no attested-fill note')
assert(pdfText.includes('PfilAtes · 10 min'), 'PDF includes a logged session line')
assert(!pdfText.includes(EXERCISE_ATTESTED_ITEM_LABEL), 'logged-only PDF does not label blank days as attested')

const yesPdfDoc = exerciseLogPdfDoc(yesReport)
const yesPdfText = exerciseLogPdfPlainText(yesPdfDoc)
assert(yesPdfDoc.stats[0]?.value === '148 min', 'Yes PDF duration includes attested blank days')
assert(yesPdfDoc.stats[1]?.value === '28 sessions · 28 of 28 days', 'Yes PDF frequency includes attested blank days')
assert(yesPdfDoc.attestedNote === EXERCISE_ATTESTED_NOTE, 'Yes PDF states the attested-fill honestly')
assert(yesPdfText.includes(EXERCISE_ATTESTED_ITEM_LABEL), 'Yes PDF labels imputed days as per patient confirmation')
assert(yesPdfText.includes(EXERCISE_ATTESTED_TIME_LABEL), 'Yes PDF marks imputed lines as Attested')
assert(yesPdfText.includes('PfilAtes · 10 min'), 'Yes PDF still includes the real logged session')
assert(yesPdfDoc.days.length === 28, 'Yes PDF lists all 28 days')
assert(!yesPdfDoc.emptyMessage, 'Yes with attested days is not an empty report')
assert(!/cure|treat|diagnos|clinician promise/i.test(yesPdfText), 'attested-fill PDF makes no new medical claim')
assert(pdfText.includes(PFILATES_SITE) && pdfText.includes(PFILATES_BRAND), 'PDF text includes logo brand and site')
assert(!/cure|treat|diagnos|clinician promise/i.test(pdfText), 'PDF makes no new medical claim')
assert(
  exerciseLogPdfFilename(report.periodEnd) === `pfilates-exercise-log-2026-09-20.pdf`,
  'PDF filename uses pfilates-exercise-log-YYYY-MM-DD',
)

const logoDataUrl = `data:image/png;base64,${readFileSync(new URL('../../public/brand/pfilates-logo.png', import.meta.url)).toString('base64')}`
const built = await buildExerciseLogPdf(report, { logoDataUrl })
assert(built.blob.type === 'application/pdf', 'built exercise PDF is an application/pdf blob')
assert(new TextDecoder('latin1').decode(built.bytes.slice(0, 5)) === '%PDF-', 'Yes path produces a PDF file')
const pdfRaw = new TextDecoder('latin1').decode(built.bytes)
assert(pdfRaw.includes('Exercise log'), 'generated PDF embeds the report title')
assert(pdfRaw.includes(PFILATES_SITE), 'generated PDF embeds www.pfilates.com')
assert(pdfRaw.includes('Alex Rivera'), 'generated PDF embeds the patient name')
assert(pdfRaw.includes('Duration'), 'generated PDF embeds duration')
assert(pdfRaw.includes('Frequency'), 'generated PDF embeds frequency')

const yesBuilt = await buildExerciseLogPdf(yesReport, { logoDataUrl })
const yesRaw = new TextDecoder('latin1').decode(yesBuilt.bytes)
assert(new TextDecoder('latin1').decode(yesBuilt.bytes.slice(0, 5)) === '%PDF-', 'Yes attested-fill path produces a PDF file')
assert(yesRaw.includes('148 min') || yesRaw.includes('148'), 'generated Yes PDF embeds attested duration')
assert(yesRaw.includes('per patient confirmation'), 'generated Yes PDF embeds the attested label')
assert(yesRaw.includes('PfilAtes'), 'generated Yes PDF still embeds a logged activity')

const brokenLogo = await buildExerciseLogPdf(report, {
  logoDataUrl: 'data:image/png;base64,not-a-real-png',
})
assert(new TextDecoder('latin1').decode(brokenLogo.bytes.slice(0, 5)) === '%PDF-', 'logo addImage failure still produces a PDF')
const brokenRaw = new TextDecoder('latin1').decode(brokenLogo.bytes)
assert(brokenRaw.includes(PFILATES_BRAND), 'logo addImage failure falls back to the PfilAtes text brand')
assert(brokenRaw.includes(PFILATES_SITE), 'logo addImage failure still embeds www.pfilates.com')

const exercisePdfSrc = readFileSync(new URL('./exercisePdf.ts', import.meta.url), 'utf8')
assert(/deliverPdfBlob/.test(exercisePdfSrc), 'exercise PDF reuses the diary phone share/download helper')
assert(/pfilatesLogoDataUrl/.test(exercisePdfSrc) && /downscaleLogoForPdf/.test(exercisePdfSrc), 'exercise PDF reuses diary logo helpers')
assert(
  /try \{[\s\S]*pdf\.addImage\(embed, 'PNG'[\s\S]*\} catch \{[\s\S]*drewLogo = false/.test(exercisePdfSrc),
  'exercise logo addImage is wrapped in try/catch so embed failure cannot abort export',
)

const homeSrc = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
assert(/EXERCISE_MISSING_CUE/.test(homeSrc), 'Home shows the missing-exercise cue')
assert(/dismissExerciseCue/.test(homeSrc), 'Home can dismiss the daily cue')
assert(/openSheet\('exercise'\)/.test(homeSrc), 'cue can open the existing exercise sheet')
assert(/A set that happened — log it even without a diary/.test(homeSrc), 'exercise can be logged when no diary is open')
assert(/START_NEW_DIARY_LABEL/.test(homeSrc) && /DownloadDiaryPdfButton/.test(homeSrc), 'Home Start New Diary and diary PDF stay in place')
assert(/to="\/ask"/.test(homeSrc), 'Home still links Ask Sara')
assert(/'PfilAtes', "Kegel's"/.test(homeSrc), "exercise sheet offers PfilAtes and Kegel's")
assert(!/Pelvic floor/.test(homeSrc) && !/'Walk'/.test(homeSrc) && !/'Stretch'/.test(homeSrc), 'exercise sheet drops Pelvic floor, walk, and stretch')

const exercisePage = readFileSync(new URL('../pages/ExerciseLog.tsx', import.meta.url), 'utf8')
assert(/GENERATE_EXERCISE_LOG_LABEL|GenerateExerciseLogButton/.test(exercisePage), 'exercise page starts from Generate exercise log')
assert(/fourWeekExerciseReport\(logs, \{ patient, gate \}\)/.test(exercisePage), 'on-screen log recomputes from the same Yes that unlocks download')
assert(/EXERCISE_ATTESTED_NOTE/.test(exercisePage), 'on-screen log explains attested blank days after Yes')
assert(/exerciseDayLines/.test(exercisePage), 'on-screen day lines distinguish logged vs attested')
assert(/PfilatesBrandHeader/.test(exercisePage), 'on-screen log shows the PfilAtes logo header')
assert(/patientName/.test(exercisePage) && /Date of birth/.test(exercisePage), 'on-screen log shows name and DOB')

const exerciseSrc = readFileSync(new URL('./exercise.ts', import.meta.url), 'utf8')
assert(!/addDiaryLog|addLog\(/.test(exerciseSrc), 'imputation does not write sessions into the log store')
assert(!/writeJson\('logs'/.test(exerciseSrc), 'imputation does not persist fake exercise logs')

const gateSrc = readFileSync(new URL('../components/GenerateExerciseLogButton.tsx', import.meta.url), 'utf8')
assert(gateSrc.includes(GENERATE_EXERCISE_LOG_LABEL) || /GENERATE_EXERCISE_LOG_LABEL/.test(gateSrc), 'generate control uses the generate label')
assert(/EXERCISE_GATE_QUESTION/.test(gateSrc), 'generate flow asks the 4-week question')
assert(/answerGate\('yes'\)/.test(gateSrc) && /answerGate\('no'\)/.test(gateSrc), 'gate offers Yes and No')
assert(/shouldAskExerciseGate/.test(gateSrc), 'generate re-asks until Yes')
assert(/canExportExerciseLogPdf/.test(gateSrc), 'Download PDF is offered only after Yes')
assert(/DOWNLOAD_PDF_LABEL/.test(gateSrc), 'Yes path offers Download PDF')
assert(!/exportExerciseLogPdf\(report\)[\s\S]{0,80}answerGate\('no'\)/.test(gateSrc), 'No path does not export a PDF')

const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
assert(/path="\/exercise"/.test(appSrc) && /path="\/diary"/.test(appSrc) && /path="\/ask"/.test(appSrc), 'exercise, diary, and Ask Sara routes stay')
assert(/path="\/r\/:token"/.test(appSrc), 'redeem route is unchanged')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/ask-sara-stage/.test(askSrc) && /ask-sara-panel/.test(askSrc), 'Ask Sara fullscreen overlay is intact')

if (process.exitCode) {
  console.error('exercise smoke failed')
  process.exit(1)
}
console.log('exercise smoke passed')
