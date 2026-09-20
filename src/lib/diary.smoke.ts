import { readFileSync } from 'node:fs'
import {
  BLADDER_LOG_KINDS,
  DIARY_ACTIVE_CUE,
  DIARY_STARTED_TOAST,
  EXERCISE_LOG_KIND,
  START_NEW_DIARY_LABEL,
  activeDiary,
  bladderDiaryReport,
  canViewDiaryReport,
  diaryStatus,
  exerciseLogReport,
  finishDiary,
  isDiaryOpen,
  latestDiary,
  logsForDiary,
  startDiary,
  summarizeLog,
} from './diary.ts'
import type { Diary, LogEntry } from './types.ts'

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

const bladder = bladderDiaryReport(open, logs)
assert(bladder.status === 'in_progress', 'bladder report is not gated on completed')
assert(bladder.drinks === 1 && bladder.leaks === 1 && bladder.pads === 1, 'bladder totals use tagged diary events')
assert(bladder.voids === 0 && bladder.urges === 0, 'void/urge counts stay on the existing what field')
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

const homeSrc = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
assert(/START_NEW_DIARY_LABEL/.test(homeSrc), 'Home has a Start New Diary button')
assert(/active \? \(/.test(homeSrc) && /Log a drink/.test(homeSrc), 'event buttons wait until a diary is active')
assert(/Void or leak/.test(homeSrc) && /Pad change/.test(homeSrc) && /Exercise/.test(homeSrc), 'Home keeps existing event types')
assert(/DIARY_ACTIVE_CUE/.test(homeSrc), 'Home shows the active-diary cue')
assert(/DIARY_STARTED_TOAST/.test(homeSrc), 'Home toasts after Start New Diary')
assert(/to="\/diary"/.test(homeSrc) && /to="\/exercise"/.test(homeSrc), 'Home links to both in-progress views')
assert(/SaraPortrait/.test(homeSrc), 'Home still uses the circular Sara portrait')
assert(!/TalkingPortrait|ask-sara-stage/.test(homeSrc), 'Home does not become fullscreen Ask Sara')

const appSrc = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
assert(/path="\/diary"/.test(appSrc) && /DiaryReport/.test(appSrc), 'App routes the bladder diary report')
assert(/path="\/exercise"/.test(appSrc) && /ExerciseLog/.test(appSrc), 'App routes the exercise log')
assert(/NeedSession/.test(appSrc) && /path="\/diary"[\s\S]*NeedSession/.test(appSrc), 'diary report stays behind the redeem session')
assert(/path="\/exercise"[\s\S]*NeedSession/.test(appSrc), 'exercise log stays behind the redeem session')

const diaryPage = readFileSync(new URL('../pages/DiaryReport.tsx', import.meta.url), 'utf8')
assert(/In progress/.test(diaryPage), 'diary report names the in-progress state')
assert(/while the diary is still open/.test(diaryPage), 'diary report stays readable before finish')
assert(/bladderDiaryReport/.test(diaryPage), 'diary page uses the shared report helper')

const exercisePage = readFileSync(new URL('../pages/ExerciseLog.tsx', import.meta.url), 'utf8')
assert(/in progress/.test(exercisePage), 'exercise log copy allows in-progress viewing')
assert(/exerciseLogReport/.test(exercisePage), 'exercise page uses the shared report helper')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/ask-sara-stage/.test(askSrc) && /ask-sara-panel/.test(askSrc), 'Ask Sara fullscreen glass overlay is intact')
assert(/font-bold/.test(askSrc) && /font-semibold/.test(askSrc), 'Ask Sara overlay copy stays bold')
assert(/speakSaraStream/.test(askSrc) && /rewritePfilatesForSpeech/.test(readFileSync(new URL('./saraStream.ts', import.meta.url), 'utf8')), 'Streams + PfilAtes speak rewrite stay in place')

if (process.exitCode) {
  console.error('diary smoke failed')
  process.exit(1)
}
console.log('diary smoke passed')
