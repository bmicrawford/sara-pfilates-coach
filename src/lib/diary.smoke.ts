import { readFileSync } from 'node:fs'
import {
  BLADDER_LOG_KINDS,
  DIARY_ACTIVE_CUE,
  DIARY_DURATION_MS,
  DIARY_STARTED_TOAST,
  EXERCISE_LOG_KIND,
  INCOMPLETE_DAY_LABEL,
  PFILATES_BRAND,
  PFILATES_SITE,
  START_NEW_DIARY_LABEL,
  activeDiary,
  bladderDiaryReport,
  buildDiaryDays,
  canViewDiaryReport,
  completeElapsedDiaries,
  diaryDayNumber,
  diaryStatus,
  exerciseLogReport,
  finishDiary,
  firstLoggedEventAt,
  isDiaryDayComplete,
  isDiaryOpen,
  latestDiary,
  localDayKey,
  logsForDiary,
  startDiary,
  summarizeLog,
} from './diary.ts'
import {
  DOWNLOAD_PDF_ANYTIME_HINT,
  DOWNLOAD_PDF_LABEL,
  bladderDiaryPdfDoc,
  bladderDiaryPdfFilename,
  bladderDiaryPdfPlainText,
  bladderDiaryReportSubtitle,
  buildBladderDiaryPdf,
  canExportBladderDiaryPdf,
  incompleteDayLabel,
} from './diaryPdf.ts'
import {
  isValidDateOfBirth,
  missingPatientFields,
  normalizePatientName,
  patientProfileComplete,
} from './patient.ts'
import type { Diary, LogEntry, PatientProfile } from './types.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

const drink: LogEntry = {
  id: 'd1',
  kind: 'drink',
  at: '2026-09-20T14:00:00.000Z',
  diaryId: 'open',
  beverage: 'Water',
  amount: 'Glass',
}
const leak: LogEntry = {
  id: 'v1',
  kind: 'voidLeak',
  at: '2026-09-20T15:00:00.000Z',
  diaryId: 'open',
  what: 'leak',
  intensity: 'Light',
}
const pad: LogEntry = {
  id: 'p1',
  kind: 'pad',
  at: '2026-09-20T16:00:00.000Z',
  diaryId: 'open',
  reason: 'Routine',
}
const session: LogEntry = {
  id: 'e1',
  kind: 'exercise',
  at: '2026-09-20T17:00:00.000Z',
  diaryId: 'open',
  activity: 'PfilAtes',
  minutes: '10',
  felt: 'Just right',
}
const otherDiaryDrink: LogEntry = {
  id: 'd2',
  kind: 'drink',
  at: '2026-09-19T14:00:00.000Z',
  diaryId: 'done',
  beverage: 'Coffee',
  amount: 'Sip',
}

const logs: LogEntry[] = [drink, leak, pad, session, otherDiaryDrink]
const open: Diary = { id: 'open', startedAt: '2026-09-20T13:00:00.000Z' }
const done: Diary = {
  id: 'done',
  startedAt: '2026-09-19T08:00:00.000Z',
  completedAt: '2026-09-19T20:00:00.000Z',
}

assert(BLADDER_LOG_KINDS.join(',') === 'drink,voidLeak,pad', 'bladder report uses existing diary kinds')
assert(EXERCISE_LOG_KIND === 'exercise', 'exercise log uses the existing exercise kind')
assert(START_NEW_DIARY_LABEL === 'Start New Diary', 'Start New Diary label is exact')
assert(/record each drink, void, leak, pad change, and exercise/i.test(DIARY_ACTIVE_CUE), 'active cue asks to record events')
assert(/in progress/i.test(DIARY_ACTIVE_CUE), 'active cue names in-progress')
assert(!/cure|treat|diagnos|clinician promise/i.test(DIARY_ACTIVE_CUE), 'active cue makes no new medical claim')
assert(/in progress/i.test(DIARY_STARTED_TOAST), 'start toast mentions in-progress review')
assert(/download the PDF/i.test(DIARY_STARTED_TOAST), 'start toast says PDF download works while in progress')
assert(/download the PDF before the diary is finished/i.test(DIARY_ACTIVE_CUE), 'active cue says PDF export works before finish')

assert(isDiaryOpen(open), 'diary without completedAt is open')
assert(!isDiaryOpen(done), 'completed diary is not open')
assert(diaryStatus(open) === 'in_progress', 'open diary status is in_progress')
assert(diaryStatus(done) === 'completed', 'finished diary status is completed')
assert(activeDiary([done, open])?.id === 'open', 'activeDiary finds the open diary')
assert(latestDiary([done])?.id === 'done', 'latestDiary falls back to a finished diary')
assert(canViewDiaryReport(open), 'in-progress diary can be viewed')
assert(canViewDiaryReport(done), 'completed diary can still be viewed')
assert(!canViewDiaryReport(null), 'null diary has no report')

const started = startDiary([], '2026-09-20T13:00:00.000Z', 'open')
assert(started.diary.id === 'open' && !started.diary.completedAt, 'startDiary creates an open diary')
const again = startDiary(started.diaries, '2026-09-20T14:00:00.000Z', 'other')
assert(again.diary.id === 'open' && again.diaries.length === 1, 'startDiary is idempotent while one is open')
const finished = finishDiary(started.diaries, 'open', '2026-09-20T22:00:00.000Z')
assert(finished[0]?.completedAt === '2026-09-20T22:00:00.000Z', 'finishDiary stamps completedAt')

const nowDay1 = '2026-09-20T18:00:00.000Z'
const patient: PatientProfile = {
  name: 'Alex Rivera',
  dateOfBirth: '1978-03-15',
  savedAt: '2026-09-01T12:00:00.000Z',
}
const bladder = bladderDiaryReport(open, logs, { now: nowDay1, patient })
assert(bladder.status === 'in_progress', 'bladder report is not gated on completed')
assert(bladder.drinks === 1 && bladder.leaks === 1 && bladder.pads === 1, 'bladder totals use tagged diary events')
assert(bladder.voids === 0 && bladder.urges === 0, 'void/urge counts stay on the existing what field')
assert(bladder.firstEventAt === drink.at, 'clock starts at the first logged event, not Start New Diary')
assert(bladder.firstEventAt !== open.startedAt, 'first event differs from the Start New Diary tap in this fixture')
assert(bladder.patientName === 'Alex Rivera', 'report uses the saved patient name')
assert(bladder.dateOfBirth === '1978-03-15', 'report uses the saved date of birth')
assert(
  bladder.entries.every((entry) => entry.kind !== 'exercise'),
  'bladder report excludes exercise',
)
assert(
  !bladder.entries.some((entry) => entry.id === 'd2'),
  'bladder report does not pull another diary’s events',
)

const exercise = exerciseLogReport(open, logs)
assert(exercise.status === 'in_progress', 'exercise log is not gated on completed')
assert(exercise.sessions === 1 && exercise.minutes === 10, 'exercise log sums the open diary')
assert(exercise.entries[0]?.activity === 'PfilAtes', 'exercise log keeps on-screen PfilAtes spelling')

const windowed: Diary = { id: 'legacy', startedAt: '2026-09-18T08:00:00.000Z' }
const legacy: LogEntry = {
  id: 'legacy-drink',
  kind: 'drink',
  at: '2026-09-18T10:00:00.000Z',
  beverage: 'Tea',
  amount: 'Glass',
}
assert(
  logsForDiary(windowed, [legacy, drink])[0]?.id === 'legacy-drink',
  'untagged logs still attach by diary time window',
)
assert(summarizeLog(drink) === 'Water · Glass', 'drink summary stays in the existing format')

const t0 = '2026-09-20T14:00:00.000Z'
assert(firstLoggedEventAt([pad, drink, leak]) === t0, 'firstLoggedEventAt is the earliest timestamp')
assert(diaryDayNumber(t0, t0) === 1, 'the first event is Day 1 T0')
assert(diaryDayNumber('2026-09-21T13:59:59.000Z', t0) === 1, 'times just under 24h stay on Day 1')
assert(diaryDayNumber('2026-09-21T14:00:00.000Z', t0) === 2, 'exactly +24h is Day 2')
assert(diaryDayNumber('2026-09-22T14:00:00.000Z', t0) === 3, 'exactly +48h is Day 3')
assert(diaryDayNumber('2026-09-23T14:00:00.000Z', t0) === null, 'exactly +72h is outside the diary')
assert(DIARY_DURATION_MS === 72 * 60 * 60 * 1000, 'three days are exactly 72 hours')
assert(!isDiaryDayComplete(null, 1, nowDay1), 'no T0 means Day 1 is not complete')
assert(!isDiaryDayComplete(t0, 1, '2026-09-21T13:59:59.000Z'), 'Day 1 is incomplete before 24h elapse')
assert(isDiaryDayComplete(t0, 1, '2026-09-21T14:00:00.000Z'), 'Day 1 completes at +24h')

const day1Drink: LogEntry = { ...drink, id: 't-d1', at: t0, diaryId: 'span' }
const day2Void: LogEntry = {
  id: 't-v2',
  kind: 'voidLeak',
  at: '2026-09-21T15:00:00.000Z',
  diaryId: 'span',
  what: 'void',
  intensity: 'Everyday',
}
const day3Pad: LogEntry = {
  id: 't-p3',
  kind: 'pad',
  at: '2026-09-22T16:00:00.000Z',
  diaryId: 'span',
  reason: 'Damp',
}
const afterWindow: LogEntry = { ...drink, id: 't-late', at: '2026-09-23T14:05:00.000Z', diaryId: 'span' }
const span: Diary = { id: 'span', startedAt: '2026-09-20T08:00:00.000Z' }
const spanLogs = [day1Drink, day2Void, day3Pad, afterWindow]

const duringDay1 = bladderDiaryReport(span, spanLogs, { now: '2026-09-20T18:00:00.000Z', patient })
assert(duringDay1.firstEventAt === t0, 'span report clock ignores the earlier Start New Diary tap')
assert(duringDay1.days[0]?.drinks === 1 && duringDay1.days[0]?.incomplete, 'Day 1 totals exist and stay incomplete during the first 24h')
assert(duringDay1.days[1]?.incomplete && duringDay1.days[1]?.voids === 1, 'Day 2 is incomplete during Day 1 and still shows events already in that window')
assert(duringDay1.days[2]?.incomplete && duringDay1.days[2]?.pads === 1, 'Day 3 is incomplete during Day 1 and still shows events already in that window')
assert(duringDay1.days[0]?.voids === 0 && duringDay1.days[0]?.pads === 0, 'later-day events are not counted on Day 1')
assert(incompleteDayLabel(duringDay1.days[1]!) === INCOMPLETE_DAY_LABEL, 'Day 2 uses the Incomplete label')

const duringDay2 = bladderDiaryReport(span, spanLogs, { now: '2026-09-21T16:00:00.000Z', patient })
assert(duringDay2.days[0]?.complete && duringDay2.days[0]?.drinks === 1, 'Day 1 is complete after 24h and keeps its totals')
assert(duringDay2.days[1]?.incomplete && duringDay2.days[1]?.voids === 1, 'Day 2 totals are counted while that 24h window is open')
assert(duringDay2.days[2]?.incomplete, 'Day 3 stays incomplete on Day 2')

const finishedWindow = bladderDiaryReport(span, spanLogs, { now: '2026-09-23T14:00:00.000Z', patient })
assert(finishedWindow.status === 'completed', 'diary is complete at exactly 72 hours from the first event')
assert(finishedWindow.days.every((day) => day.complete), 'all three days are complete after 72 hours')
assert(finishedWindow.days[2]?.pads === 1, 'Day 3 totals include events in the third 24h window')
assert(finishedWindow.entries.every((entry) => entry.id !== 't-late'), 'events after 72 hours are outside the report')

const emptyStart = bladderDiaryReport(open, [], { now: nowDay1, patient })
assert(emptyStart.firstEventAt === null, 'no logged event means the clock has not started')
assert(emptyStart.days[0]?.incomplete && emptyStart.days[0]?.empty, 'Day 1 is incomplete when the diary started with no events')
assert(
  incompleteDayLabel(emptyStart.days[0]!) === `${INCOMPLETE_DAY_LABEL} — no events yet`,
  'empty Day 1 after start is labeled honestly',
)
assert(emptyStart.days[1]?.incomplete && emptyStart.days[2]?.incomplete, 'Day 2 and Day 3 are incomplete before any events')

const autoClosed = completeElapsedDiaries([span], spanLogs, '2026-09-23T15:00:00.000Z')
assert(autoClosed[0]?.completedAt === '2026-09-23T14:00:00.000Z', 'elapsed diaries stamp completedAt at T0+72h')

const buckets = buildDiaryDays([day1Drink, day2Void], t0, '2026-09-21T16:00:00.000Z')
assert(buckets[0]?.complete && buckets[1]?.incomplete && buckets[2]?.incomplete, 'buildDiaryDays marks unfinished days incomplete')

const homeSrc = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
assert(/START_NEW_DIARY_LABEL/.test(homeSrc), 'Home has a Start New Diary button')
assert(/active \? \(/.test(homeSrc) && /Log a drink/.test(homeSrc), 'event buttons wait until a diary is active')
assert(/Void or leak/.test(homeSrc) && /Pad change/.test(homeSrc) && /Exercise/.test(homeSrc), 'Home keeps existing event types')
assert(/DIARY_ACTIVE_CUE/.test(homeSrc), 'Home shows the active-diary cue')
assert(/DIARY_STARTED_TOAST/.test(homeSrc), 'Home toasts after Start New Diary')
assert(/to="\/diary"/.test(homeSrc) && /to="\/exercise"/.test(homeSrc), 'Home links to both in-progress views')
assert(/DownloadDiaryPdfButton/.test(homeSrc), 'Home offers Download PDF on the logging screen')
assert(/bladderDiaryReport/.test(homeSrc), 'Home uses the same branded report helper for PDF export')
assert(
  /activeReport \? <DownloadDiaryPdfButton report=\{activeReport\}/.test(homeSrc),
  'Home Download PDF is shown while the diary is active',
)
assert(/Download PDF anytime/.test(homeSrc), 'Home report card names Download PDF while the diary is active')
assert(/SaraPortrait/.test(homeSrc), 'Home still uses the circular Sara portrait')
assert(!/TalkingPortrait|ask-sara-stage/.test(homeSrc), 'Home does not become fullscreen Ask Sara')

const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
assert(/path="\/diary"/.test(appSrc) && /DiaryReport/.test(appSrc), 'App routes the bladder diary report')
assert(/path="\/exercise"/.test(appSrc) && /ExerciseLog/.test(appSrc), 'App routes the exercise log')
assert(/NeedSession/.test(appSrc) && /path="\/diary"[\s\S]*NeedSession/.test(appSrc), 'diary report stays behind the redeem session')
assert(/path="\/exercise"[\s\S]*NeedSession/.test(appSrc), 'exercise log stays behind the redeem session')
assert(/PatientOnboarding/.test(appSrc) && /NeedProfile/.test(appSrc), 'first-open profile gate wraps the companion')
assert(/path="\/r\/:token"/.test(appSrc) && !/NeedProfile[\s\S]*Redeem/.test(appSrc), 'redeem gate is unchanged')

const diaryPage = readFileSync(new URL('../pages/DiaryReport.tsx', import.meta.url), 'utf8')
const pdfButton = readFileSync(new URL('../components/DownloadDiaryPdfButton.tsx', import.meta.url), 'utf8')
assert(/DownloadDiaryPdfButton/.test(diaryPage), 'diary report offers Download PDF')
assert(/exportBladderDiaryPdf/.test(pdfButton), 'Download PDF uses the shared branded export helper')
assert(
  /\{pdfBusy \? 'Preparing PDF…' : DOWNLOAD_PDF_LABEL\}/.test(pdfButton),
  'Download PDF is rendered on the in-progress and completed report',
)
assert(/disabled=\{pdfBusy\}/.test(pdfButton), 'Download PDF is only disabled while preparing — not by completeness')
assert(
  !/isThreeDayWindowComplete|completedAt|days\.every|72h|all days complete/.test(pdfButton),
  'Download PDF button is not gated on finish, 72h, or all days complete',
)
assert(/DOWNLOAD_PDF_ANYTIME_HINT/.test(pdfButton), 'Download PDF says export works before the diary is finished')
assert(
  !/No diary yet[\s\S]{0,500}DownloadDiaryPdfButton/.test(diaryPage),
  'empty no-diary state does not offer a PDF',
)
assert(/bladderDiaryReportSubtitle/.test(diaryPage), 'diary report names the in-progress state via shared copy')
assert(/while the diary is still open/.test(bladderDiaryReportSubtitle(bladder)), 'diary report stays readable before finish')
assert(/bladderDiaryReport/.test(diaryPage), 'diary page uses the shared report helper')
assert(/PfilatesBrandHeader/.test(diaryPage), 'on-screen report shows the PfilAtes logo header')
assert(/DayCard/.test(diaryPage) && /report\.days\.map/.test(diaryPage), 'on-screen report lists Day 1–3 totals')
assert(/incompleteDayLabel/.test(diaryPage), 'on-screen report marks incomplete days')
assert(/Date of birth/.test(diaryPage) && /patientName/.test(diaryPage), 'on-screen report shows name and date of birth')

assert(DOWNLOAD_PDF_LABEL === 'Download PDF', 'Download PDF label is exact')
assert(
  /before the diary is finished/i.test(DOWNLOAD_PDF_ANYTIME_HINT),
  'PDF hint says export works before the diary is finished',
)
assert(/incomplete days/i.test(DOWNLOAD_PDF_ANYTIME_HINT), 'PDF hint says incomplete days are included')
assert(canExportBladderDiaryPdf(bladder), 'in-progress Day-1-only report is exportable')
assert(canExportBladderDiaryPdf(emptyStart), 'zero-event in-progress report is still exportable')
assert(canExportBladderDiaryPdf(duringDay1), 'Day-1-only span report is exportable while Days 2/3 are incomplete')
assert(!canExportBladderDiaryPdf(null), 'PDF export stays unavailable when there is no diary')
assert(
  !/status === 'completed'|isThreeDayWindowComplete|all days/.test(
    readFileSync(new URL('./diaryPdf.ts', import.meta.url), 'utf8').match(
      /export function canExportBladderDiaryPdf[\s\S]*?^}/m,
    )?.[0] ?? '',
  ),
  'canExportBladderDiaryPdf is not gated on finished / 72h / all days complete',
)
assert(
  bladderDiaryPdfFilename(open.startedAt) === `pfilates-bladder-diary-${localDayKey(open.startedAt)}.pdf`,
  'PDF filename uses pfilates-bladder-diary-YYYY-MM-DD',
)
assert(
  /^pfilates-bladder-diary-\d{4}-\d{2}-\d{2}\.pdf$/.test(bladderDiaryPdfFilename(open.startedAt)),
  'PDF filename is date-stamped',
)

const pdfDoc = bladderDiaryPdfDoc(bladder)
const pdfText = bladderDiaryPdfPlainText(pdfDoc)
assert(pdfDoc.title === 'Bladder diary report', 'PDF title matches the report screen')
assert(pdfDoc.status === 'In progress', 'in-progress PDF keeps the on-screen status')
assert(pdfDoc.brand === PFILATES_BRAND && pdfDoc.site === PFILATES_SITE, 'PDF header uses PfilAtes and www.pfilates.com')
assert(pdfDoc.patientName === 'Alex Rivera', 'PDF includes the patient name')
assert(pdfText.includes('Date of birth:'), 'PDF includes the date of birth label')
assert(pdfDoc.days[0]?.heading === 'Day 1' && pdfDoc.days[1]?.heading === 'Day 2' && pdfDoc.days[2]?.heading === 'Day 3', 'PDF has Day 1–3 sections')
assert(
  pdfDoc.days[0]?.stats.map((stat) => `${stat.label}:${stat.value}`).join('|') ===
    'Drinks:1|Voids:0|Leaks:1|Urges:0|Pad changes:1',
  'PDF Day 1 stats match the on-screen Day 1 totals',
)
assert(pdfDoc.days[1]?.incomplete === INCOMPLETE_DAY_LABEL, 'PDF marks Day 2 incomplete during Day 1')
assert(pdfDoc.days[2]?.incomplete === INCOMPLETE_DAY_LABEL, 'PDF marks Day 3 incomplete during Day 1')
assert(pdfText.includes('Water · Glass'), 'PDF includes the same drink line as the report')
assert(pdfText.includes('Leak · Light'), 'PDF includes the same leak line as the report')
assert(pdfText.includes(PFILATES_SITE) && pdfText.includes(PFILATES_BRAND), 'PDF text includes logo brand and site')
assert(!/cure|treat|diagnos|clinician promise/i.test(pdfText), 'PDF makes no new medical claim')

const finishedPdf = bladderDiaryPdfDoc(bladderDiaryReport(done, logs, { now: '2026-09-20T12:00:00.000Z', patient }))
assert(finishedPdf.status === 'Finished', 'completed diary PDF is still available')
assert(finishedPdf.stats.find((stat) => stat.label === 'Drinks')?.value === 1, 'finished PDF uses that diary’s events')
assert(finishedPdf.days.some((day) => day.incomplete), 'early-finished diary still marks unelapsed days incomplete')

const exercisePage = readFileSync(new URL('../pages/ExerciseLog.tsx', import.meta.url), 'utf8')
assert(/fourWeekExerciseReport/.test(exercisePage), 'exercise page uses the 4-week report helper')
assert(/Duration/.test(exercisePage) && /Frequency/.test(exercisePage), 'exercise log shows duration and frequency')
assert(/GenerateExerciseLogButton/.test(exercisePage), 'exercise page offers the gated generate/download flow')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/ask-sara-stage/.test(askSrc) && /ask-sara-panel/.test(askSrc), 'Ask Sara fullscreen glass overlay is intact')
assert(/font-bold/.test(askSrc) && /font-semibold/.test(askSrc), 'Ask Sara overlay copy stays bold')
assert(/speakSaraStream/.test(askSrc) && /rewritePfilatesForSpeech/.test(readFileSync(new URL('./saraStream.ts', import.meta.url), 'utf8')), 'Streams + PfilAtes speak rewrite stay in place')

const onboardingSrc = readFileSync(new URL('../pages/PatientOnboarding.tsx', import.meta.url), 'utf8')
assert(/Date of birth/.test(onboardingSrc) && /autoComplete="name"/.test(onboardingSrc), 'first-open step collects name and date of birth')
assert(/only ask once/.test(onboardingSrc), 'first-open copy says we only ask once')
assert(/savePatient/.test(onboardingSrc), 'first-open step persists the profile')
assert(normalizePatientName('  Alex   Rivera ') === 'Alex Rivera', 'patient name is trimmed, not invented')
assert(isValidDateOfBirth('1978-03-15'), 'a real calendar DOB is accepted')
assert(!isValidDateOfBirth('1978-02-30'), 'impossible DOB is rejected')
assert(!isValidDateOfBirth('2099-01-01'), 'future DOB is rejected')
assert(patientProfileComplete(patient), 'saved name + DOB is a complete profile')
assert(missingPatientFields(null).name && missingPatientFields(null).dateOfBirth, 'missing profile asks for both fields')
assert(!patientProfileComplete({ name: '', dateOfBirth: '1978-03-15', savedAt: t0 }), 'name is required so the PDF is never nameless')

assert(bladder.status === 'in_progress', 'Day-1-only fixture is still in_progress')
assert(bladder.days[0]?.drinks === 1 && bladder.days[1]?.empty && bladder.days[2]?.empty, 'Day-1-only fixture has no Day 2/3 events')
assert(bladder.days[1]?.incomplete && bladder.days[2]?.incomplete, 'Day-1-only fixture keeps Day 2/3 incomplete')

const logoDataUrl = `data:image/png;base64,${readFileSync(new URL('../../public/brand/pfilates-logo.png', import.meta.url)).toString('base64')}`
const built = await buildBladderDiaryPdf(bladder, { logoDataUrl })
assert(canExportBladderDiaryPdf(bladder), 'PDF path is not blocked for an in-progress Day-1-only diary')
assert(
  built.filename === bladderDiaryPdfFilename(bladder.firstEventAt ?? open.startedAt),
  'built PDF keeps the dated filename',
)
assert(built.blob.type === 'application/pdf', 'built PDF is an application/pdf blob')
const pdfHeader = new TextDecoder('latin1').decode(built.bytes.slice(0, 5))
assert(pdfHeader === '%PDF-', 'in-progress Day-1-only export still produces a PDF file')
const pdfRaw = new TextDecoder('latin1').decode(built.bytes)
assert(pdfRaw.includes('Bladder diary report'), 'generated PDF embeds the report title')
assert(pdfRaw.includes('Drinks'), 'generated PDF embeds the drinks stat label')
assert(pdfRaw.includes(PFILATES_SITE), 'generated PDF embeds www.pfilates.com')
assert(pdfRaw.includes('Alex Rivera'), 'generated PDF embeds the patient name')
assert(pdfRaw.includes('Incomplete'), 'generated PDF embeds incomplete day markers')
assert(pdfRaw.includes('Day 1') && pdfRaw.includes('Day 2') && pdfRaw.includes('Day 3'), 'generated PDF embeds Day 1–3 headings')
assert(pdfRaw.includes('In progress'), 'generated in-progress PDF is not rewritten as finished')

const emptyBuilt = await buildBladderDiaryPdf(emptyStart, { logoDataUrl })
assert(canExportBladderDiaryPdf(emptyStart), 'PDF path is not blocked when zero days have events')
assert(new TextDecoder('latin1').decode(emptyBuilt.bytes.slice(0, 5)) === '%PDF-', 'zero-event in-progress diary still builds a PDF')

const pdfSrc = readFileSync(new URL('./diaryPdf.ts', import.meta.url), 'utf8')
assert(/pdf\.addImage\(embed, 'PNG'/.test(pdfSrc), 'logo embed still uses addImage PNG')
assert(
  /try \{[\s\S]*pdf\.addImage\(embed, 'PNG'[\s\S]*\} catch \{[\s\S]*drewLogo = false/.test(pdfSrc),
  'logo addImage is wrapped in try/catch so embed failure cannot abort export',
)
assert(/downscaleLogoForPdf/.test(pdfSrc), 'logo is downscaled on canvas before embed when the browser allows it')
assert(/downloadAttributeIsNoop/.test(pdfSrc) && /openPdfInNewTab/.test(pdfSrc), 'iOS/PWA share fallback can open the blob URL')
assert(
  /if \(isShareAbort\(error\)\) return[\s\S]*if \(downloadAttributeIsNoop\(\)\)[\s\S]*openPdfInNewTab\(blob\)/.test(
    pdfSrc,
  ),
  'non-abort share failure on iOS/PWA opens the PDF in a new tab instead of a.download',
)

const brokenLogo = await buildBladderDiaryPdf(bladder, {
  logoDataUrl: 'data:image/png;base64,not-a-real-png',
})
assert(brokenLogo.blob instanceof Blob, 'logo addImage failure still returns a blob')
assert(brokenLogo.blob.type === 'application/pdf', 'logo addImage failure still returns an application/pdf blob')
assert(brokenLogo.blob.size > 0, 'logo addImage failure still returns a non-empty PDF blob')
assert(
  new TextDecoder('latin1').decode(brokenLogo.bytes.slice(0, 5)) === '%PDF-',
  'logo addImage failure still produces a PDF file',
)
const brokenRaw = new TextDecoder('latin1').decode(brokenLogo.bytes)
assert(brokenRaw.includes(PFILATES_BRAND), 'logo addImage failure falls back to the PfilAtes text brand')
assert(brokenRaw.includes('Bladder diary report'), 'logo addImage failure still embeds the report title')
assert(brokenRaw.includes('Incomplete'), 'logo addImage failure keeps incomplete-day export')

if (process.exitCode) {
  console.error('diary smoke failed')
  process.exit(1)
}
console.log('diary smoke passed')
