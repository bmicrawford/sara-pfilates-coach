import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  REMINDER_TIME_HINT,
  adherenceSummary,
  answerSymptomCheck,
  checkedToday,
  currentWorksheet,
  everydayMovementIds,
  isPlanPaused,
  readMovementPlan,
  readReminderTime,
  resumeAfterProviderClearance,
  setEverydayMovementDone,
  shouldShowRestartCue,
  stopMovementForPain,
  symptomCheckDue,
  syncPregnancyExclusions,
  todayPlanComplete,
  writeReminderTime,
  type MovementPlanState,
} from '../lib/movementPlan'
import {
  COURSE_LINE,
  HEALTH_SCREEN_TITLE,
  NO_EVERYDAY_PLAN_MESSAGE,
  PAIN_REDO_LINE,
  PAIN_STOP_LINE,
  RESTART_CUE,
  RESUME_AFTER_EVALUATION,
  STOP_ALL_MOVEMENTS_LINE,
  SYMPTOM_CHECK_QUESTION,
  SYMPTOMS_WORSE_LINK,
  THIS_CAUSED_PAIN,
  WORKSHEET_INTRO,
  WORKSHEET_REDO_PROMPT,
  WORKSHEET_TITLE,
  movementName,
} from '../lib/movements'

type Props = {
  onLogsChange?: () => void
}

export function TodayPlanCard({ onLogsChange }: Props) {
  const [plan, setPlan] = useState<MovementPlanState>(() => syncPregnancyExclusions())
  const [now, setNow] = useState(() => new Date())
  const [askSymptoms, setAskSymptoms] = useState(false)

  useEffect(() => {
    const sync = () => {
      const nextNow = new Date()
      setPlan(syncPregnancyExclusions(nextNow))
      setNow(nextNow)
    }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const current = currentWorksheet(plan)
  const selected = everydayMovementIds(plan)
  const checked = new Set(checkedToday(plan, now))
  const adherence = adherenceSummary(plan, now)
  const restart = shouldShowRestartCue(plan, now)
  const done = todayPlanComplete(plan, now)
  const paused = isPlanPaused(plan)
  const weeklyDue = symptomCheckDue(plan, now) && selected.length > 0
  const showSymptomQuestion = !paused && (weeklyDue || askSymptoms)

  const toggle = (movementId: string) => {
    const next = setEverydayMovementDone(movementId, !checked.has(movementId), new Date())
    setPlan(next)
    setNow(new Date())
    onLogsChange?.()
  }

  const stopForPain = (movementId: string) => {
    const next = stopMovementForPain(movementId, new Date())
    setPlan(next)
    setNow(new Date())
    onLogsChange?.()
  }

  const answerSymptoms = (gettingWorse: boolean) => {
    setPlan(answerSymptomCheck(gettingWorse, new Date()))
    setAskSymptoms(false)
    setNow(new Date())
  }

  return (
    <section className="glass-card mb-4 px-4 py-4" aria-label="Today's everyday movements">
      {paused ? (
        <>
          <p className="text-sm font-bold leading-relaxed text-black">{STOP_ALL_MOVEMENTS_LINE}</p>
          <button
            type="button"
            onClick={() => {
              setPlan(resumeAfterProviderClearance(new Date()))
              setNow(new Date())
            }}
            className="mt-4 w-full rounded-3xl bg-sage px-4 py-3 text-sm font-bold leading-snug text-white"
          >
            {RESUME_AFTER_EVALUATION}
          </button>
        </>
      ) : !current ? (
        <>
          <h2 className="font-serif text-2xl font-bold text-black">{WORKSHEET_TITLE}</h2>
          <p className="mt-2 text-sm font-bold leading-relaxed text-black">{WORKSHEET_INTRO}</p>
          <Link
            to="/worksheet"
            className="mt-4 block rounded-full bg-sage py-3 text-center text-sm font-bold text-white"
          >
            Fill out the worksheet
          </Link>
          <SymptomCheck
            showQuestion={showSymptomQuestion}
            onAnswer={answerSymptoms}
            onAsk={() => setAskSymptoms(true)}
          />
        </>
      ) : selected.length === 0 ? (
        <>
          <h2 className="font-serif text-2xl font-bold text-black">{WORKSHEET_TITLE}</h2>
          {plan.painRedoPrompt ? (
            <p className="mt-2 text-sm font-bold leading-relaxed text-black">{PAIN_REDO_LINE}</p>
          ) : plan.worksheetRedoPrompt ? (
            <p className="mt-2 text-sm font-bold leading-relaxed text-black">{WORKSHEET_REDO_PROMPT}</p>
          ) : (
            <p className="mt-2 text-sm font-bold leading-relaxed text-black">{NO_EVERYDAY_PLAN_MESSAGE}</p>
          )}
          <Link
            to="/worksheet"
            className="mt-4 block text-center text-sm font-bold text-black underline decoration-black/30 underline-offset-4"
          >
            Redo worksheet
          </Link>
          <SymptomCheck
            showQuestion={showSymptomQuestion}
            onAnswer={answerSymptoms}
            onAsk={() => setAskSymptoms(true)}
          />
        </>
      ) : (
        <>
          <h2 className="font-serif text-2xl font-bold leading-tight text-black">Today's everyday movements</h2>
          {showSymptomQuestion ? (
            <SymptomQuestion onAnswer={answerSymptoms} />
          ) : null}
          <p className="mt-3 text-sm font-bold leading-relaxed text-black">{PAIN_STOP_LINE}</p>
          <ul className="mt-3 space-y-3">
            {selected.map((id) => {
              const on = checked.has(id)
              return (
                <li key={id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(id)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white/50 px-3 text-left text-base font-bold text-black"
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-black text-sm ${
                        on ? 'bg-black text-white' : 'bg-white/80 text-transparent'
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    {movementName(id)}
                  </button>
                  <button
                    type="button"
                    onClick={() => stopForPain(id)}
                    className="mt-1 min-h-11 w-full rounded-2xl px-3 text-left text-sm font-bold text-black underline decoration-black/30 underline-offset-4"
                  >
                    {THIS_CAUSED_PAIN}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-sm font-bold text-black">{COURSE_LINE}</p>
          <p className="mt-2 text-sm font-bold text-black">{adherence.line}</p>
          {done ? <p className="mt-2 text-sm font-bold text-black">Logged for today.</p> : null}
          {restart ? <p className="mt-2 text-sm font-bold leading-relaxed text-black">{RESTART_CUE}</p> : null}
          {plan.painRedoPrompt ? (
            <p className="mt-2 text-sm font-bold leading-relaxed text-black">{PAIN_REDO_LINE}</p>
          ) : null}
          {showSymptomQuestion ? null : (
            <button
              type="button"
              onClick={() => setAskSymptoms(true)}
              className="mt-3 min-h-11 w-full text-left text-sm font-bold text-black underline decoration-black/30 underline-offset-4"
            >
              {SYMPTOMS_WORSE_LINK}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function SymptomCheck({
  showQuestion,
  onAnswer,
  onAsk,
}: {
  showQuestion: boolean
  onAnswer: (gettingWorse: boolean) => void
  onAsk: () => void
}) {
  if (showQuestion) return <SymptomQuestion onAnswer={onAnswer} />
  return (
    <button
      type="button"
      onClick={onAsk}
      className="mt-3 min-h-11 w-full text-left text-sm font-bold text-black underline decoration-black/30 underline-offset-4"
    >
      {SYMPTOMS_WORSE_LINK}
    </button>
  )
}

function SymptomQuestion({ onAnswer }: { onAnswer: (gettingWorse: boolean) => void }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-bold leading-relaxed text-black">{SYMPTOM_CHECK_QUESTION}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="answer-choice text-sm" onClick={() => onAnswer(true)}>
          Yes
        </button>
        <button type="button" className="answer-choice text-sm" onClick={() => onAnswer(false)}>
          No
        </button>
      </div>
    </div>
  )
}

export function MovementPhoneSettings() {
  const [plan, setPlan] = useState<MovementPlanState>(() => readMovementPlan())
  const reminder = readReminderTime(plan)
  const hasWorksheet = currentWorksheet(plan) !== null

  useEffect(() => {
    const sync = () => setPlan(readMovementPlan())
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  return (
    <section className="glass-card mt-6 px-4 py-4" aria-label="On this phone">
      <h2 className="font-serif text-xl font-bold text-black">On this phone</h2>
      <Link
        to="/worksheet?edit=health"
        className="mt-3 block min-h-11 rounded-2xl bg-white/55 px-3 py-3 text-sm font-bold text-black"
      >
        {HEALTH_SCREEN_TITLE}
      </Link>
      <Link
        to="/worksheet"
        className="mt-3 block min-h-11 rounded-2xl bg-white/55 px-3 py-3 text-sm font-bold text-black"
      >
        {hasWorksheet ? 'Redo worksheet' : WORKSHEET_TITLE}
      </Link>
      <label className="mt-4 block text-sm font-bold text-black">
        Reminder time
        <input
          type="time"
          value={reminder ?? ''}
          onChange={(event) => setPlan(writeReminderTime(event.target.value || null))}
          className="mt-1.5 min-h-11 w-full rounded-2xl border border-black/15 bg-white/75 px-3 text-base font-bold text-black"
        />
      </label>
      <p className="mt-2 text-xs font-bold leading-relaxed text-black">{REMINDER_TIME_HINT}</p>
    </section>
  )
}
