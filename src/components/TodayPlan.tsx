import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  REMINDER_TIME_HINT,
  adherenceSummary,
  checkedToday,
  currentWorksheet,
  everydayMovementIds,
  readMovementPlan,
  readReminderTime,
  setEverydayMovementDone,
  shouldShowRestartCue,
  todayPlanComplete,
  writeReminderTime,
  type MovementPlanState,
} from '../lib/movementPlan'
import {
  COURSE_LINE,
  NO_EVERYDAY_PLAN_MESSAGE,
  RESTART_CUE,
  WORKSHEET_INTRO,
  WORKSHEET_TITLE,
  movementName,
} from '../lib/movements'

type Props = {
  onLogsChange?: () => void
}

export function TodayPlanCard({ onLogsChange }: Props) {
  const [plan, setPlan] = useState<MovementPlanState>(() => readMovementPlan())
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const sync = () => {
      setPlan(readMovementPlan())
      setNow(new Date())
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

  const toggle = (movementId: string) => {
    const next = setEverydayMovementDone(movementId, !checked.has(movementId), new Date())
    setPlan(next)
    setNow(new Date())
    onLogsChange?.()
  }

  return (
    <section className="glass-card mb-4 px-4 py-4" aria-label="Today's everyday movements">
      {!current ? (
        <>
          <h2 className="font-serif text-2xl font-bold text-black">{WORKSHEET_TITLE}</h2>
          <p className="mt-2 text-sm font-bold leading-relaxed text-black">{WORKSHEET_INTRO}</p>
          <Link
            to="/worksheet"
            className="mt-4 block rounded-full bg-sage py-3 text-center text-sm font-bold text-white"
          >
            Fill out the worksheet
          </Link>
        </>
      ) : selected.length === 0 ? (
        <>
          <h2 className="font-serif text-2xl font-bold text-black">{WORKSHEET_TITLE}</h2>
          <p className="mt-2 text-sm font-bold leading-relaxed text-black">{NO_EVERYDAY_PLAN_MESSAGE}</p>
          <Link
            to="/worksheet"
            className="mt-4 block text-center text-sm font-bold text-black underline decoration-black/30 underline-offset-4"
          >
            Redo worksheet
          </Link>
        </>
      ) : (
        <>
          <h2 className="font-serif text-2xl font-bold leading-tight text-black">Today's everyday movements</h2>
          <ul className="mt-3 space-y-2">
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
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-sm font-bold text-black">{COURSE_LINE}</p>
          <p className="mt-2 text-sm font-bold text-black">{adherence.line}</p>
          {done ? <p className="mt-2 text-sm font-bold text-black">Logged for today.</p> : null}
          {restart ? <p className="mt-2 text-sm font-bold leading-relaxed text-black">{RESTART_CUE}</p> : null}
        </>
      )}
    </section>
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
