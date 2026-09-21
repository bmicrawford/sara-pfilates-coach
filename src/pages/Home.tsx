import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { Chip, Field, inputClass } from '../components/Chip'
import { InstallHint } from '../components/InstallHint'
import { SaraPortrait } from '../components/SaraPortrait'
import { DownloadDiaryPdfButton } from '../components/DownloadDiaryPdfButton'
import {
  DIARY_ACTIVE_CUE,
  DIARY_STARTED_TOAST,
  START_NEW_DIARY_LABEL,
  activeDiary,
  bladderDiaryReport,
  summarizeLog,
} from '../lib/diary'
import {
  EXERCISE_CUE_DISMISS_LABEL,
  EXERCISE_MISSING_CUE,
  dismissExerciseCue,
  markExerciseCueShown,
  shouldShowExerciseCue,
} from '../lib/exercise'
import { addDiaryLog, finishActiveDiary, readDiaries, readLogs, startNewDiary, syncDiaryWindows } from '../lib/mockServer'
import { patientFirstName, readPatient } from '../lib/patient'
import { markCompanionOpened } from '../lib/notifications'
import {
  DRINK_OZ_DEFAULT,
  drinkEventVolume,
  mlToOz,
  ozToMl,
  readDrinkUnit,
  sliderBounds,
  writeDrinkUnit,
} from '../lib/drinkVolume'
import {
  formatTime,
  fromDatetimeLocal,
  isSameLocalDay,
  toDatetimeLocal,
  uid,
} from '../lib/storage'
import type { Diary, DrinkVolumeUnit, LogEntry, Mood, Session, SheetId } from '../lib/types'

const IDLE_MS = 11_000
const CELEBRATE_MS = 3800

type Props = {
  session: Session
}

export function Home({ session }: Props) {
  const [mood, setMood] = useState<Mood>('default')
  const [sheet, setSheet] = useState<SheetId>(null)
  const [logs, setLogs] = useState<LogEntry[]>(() => readLogs())
  const [diaries, setDiaries] = useState<Diary[]>(() => syncDiaryWindows())
  const patient = readPatient()
  const [smsNote, setSmsNote] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [exerciseCue, setExerciseCue] = useState(() => shouldShowExerciseCue(readLogs()))
  const active = useMemo(() => activeDiary(diaries), [diaries])
  const activeReport = useMemo(
    () => (active ? bladderDiaryReport(active, logs, { patient }) : null),
    [active, logs, patient],
  )

  useEffect(() => {
    const evaled = markCompanionOpened()
    if (evaled.wouldSendSms) {
      setSmsNote(
        `Stub SMS: it's been ${evaled.daysSinceOpen.toFixed(0)} days. A real send would check in by text.`,
      )
    }
  }, [])

  useEffect(() => {
    if (!exerciseCue) return
    markExerciseCueShown()
  }, [exerciseCue])

  useEffect(() => {
    if (sheet || mood === 'celebrate' || mood === 'listening') return
    const t = window.setTimeout(() => setMood('neutral'), IDLE_MS)
    return () => window.clearTimeout(t)
  }, [sheet, mood, logs])

  const today = useMemo(() => logs.filter((l) => isSameLocalDay(l.at)), [logs])
  const counts = useMemo(
    () => ({
      drink: today.filter((l) => l.kind === 'drink').length,
      voidLeak: today.filter((l) => l.kind === 'voidLeak').length,
      pad: today.filter((l) => l.kind === 'pad').length,
      exercise: today.filter((l) => l.kind === 'exercise').length,
    }),
    [today],
  )

  const openSheet = (id: Exclude<SheetId, null>) => {
    setSheet(id)
    setMood('listening')
  }

  const closeSheet = () => {
    setSheet(null)
    setMood('default')
  }

  const saveLog = (entry: LogEntry) => {
    addDiaryLog(entry)
    const nextLogs = readLogs()
    setLogs(nextLogs)
    setExerciseCue(shouldShowExerciseCue(nextLogs))
    setSheet(null)
    setMood('celebrate')
    window.setTimeout(() => setMood('default'), CELEBRATE_MS)
  }

  const beginDiary = () => {
    startNewDiary()
    setDiaries(readDiaries())
    setToast(DIARY_STARTED_TOAST)
    setMood('listening')
    window.setTimeout(() => setToast(null), 4800)
  }

  const finishDiary = () => {
    finishActiveDiary()
    setDiaries(readDiaries())
    setSheet(null)
    setMood('celebrate')
    window.setTimeout(() => setMood('default'), CELEBRATE_MS)
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-5 pb-12 safe-top">
      <header className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
          With Sara
        </p>
        <Link to="/move" className="text-xs text-ink-faint hover:text-ink-mute">
          New phone
        </Link>
      </header>

      <div className="mt-6">
        <SaraPortrait mood={mood} />
        <p className="mt-1 text-center text-sm text-ink-mute">
          {greeting()}, {patientFirstName(patient) ?? firstName(session.email)}.
        </p>
      </div>

      <div className="mt-6">
        <InstallHint />
      </div>

      {smsNote ? (
        <p className="mb-4 rounded-2xl bg-sage-mist px-4 py-3 text-xs text-ink-mute">{smsNote}</p>
      ) : null}

      {active ? (
        <p
          role="status"
          className="mb-4 rounded-2xl bg-sage-mist px-4 py-3 text-sm text-ink"
        >
          {DIARY_ACTIVE_CUE}
        </p>
      ) : null}

      {exerciseCue ? (
        <div
          role="status"
          className="mb-4 rounded-2xl bg-sage-mist px-4 py-3 text-sm text-ink"
        >
          <p>{EXERCISE_MISSING_CUE}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-full bg-sage px-3.5 py-1.5 text-xs font-semibold text-white"
              onClick={() => openSheet('exercise')}
            >
              Log exercise
            </button>
            <button
              type="button"
              className="rounded-full px-3.5 py-1.5 text-xs font-medium text-sage-deep"
              onClick={() => {
                dismissExerciseCue()
                setExerciseCue(false)
              }}
            >
              {EXERCISE_CUE_DISMISS_LABEL}
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Today</p>
        <p className="mt-1 text-sm text-ink">
          {!active
            ? 'Start a diary to log drinks, voids, leaks, and pads. Exercise can be logged anytime.'
            : today.length === 0
              ? 'Nothing logged yet — whenever you’re ready.'
              : `${counts.drink} drink${counts.drink === 1 ? '' : 's'} · ${counts.voidLeak} void/leak · ${counts.pad} pad · ${counts.exercise} exercise`}
        </p>
      </section>

      {active ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Action label="Log a drink" hint="How much you had" onClick={() => openSheet('drink')} />
            <Action label="Void (pee) or leak" hint="No judgment" onClick={() => openSheet('voidLeak')} />
            <Action label="Pad change" hint="Time + reason" onClick={() => openSheet('pad')} />
            <Action label="Exercise" hint="A set that happened" onClick={() => openSheet('exercise')} />
          </div>
          {activeReport ? <DownloadDiaryPdfButton report={activeReport} className="mt-3" /> : null}
        </>
      ) : (
        <>
          <button
            type="button"
            className="mt-5 w-full rounded-2xl bg-sage py-4 text-center font-semibold text-white shadow-card"
            onClick={beginDiary}
          >
            {START_NEW_DIARY_LABEL}
          </button>
          <button
            type="button"
            className="mt-3 w-full rounded-2xl bg-cream-card px-4 py-4 text-left shadow-card transition hover:ring-2 hover:ring-sage/30"
            onClick={() => openSheet('exercise')}
          >
            <span className="block font-semibold text-ink">Exercise</span>
            <span className="mt-1 block text-xs text-ink-mute">A set that happened — log it even without a diary</span>
          </button>
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link
          to="/diary"
          className="rounded-2xl bg-cream-card px-4 py-4 text-left shadow-card transition hover:ring-2 hover:ring-sage/30"
        >
          <span className="block font-semibold text-ink">Bladder diary report</span>
          <span className="mt-1 block text-xs text-ink-mute">
            {active ? 'Download PDF anytime — even if incomplete' : 'Readable before it is finished'}
          </span>
        </Link>
        <Link
          to="/exercise"
          className="rounded-2xl bg-cream-card px-4 py-4 text-left shadow-card transition hover:ring-2 hover:ring-sage/30"
        >
          <span className="block font-semibold text-ink">Exercise log</span>
          <span className="mt-1 block text-xs text-ink-mute">Duration and frequency · 4 weeks</span>
        </Link>
      </div>

      <Link
        to="/ask"
        className="mt-3 block rounded-2xl bg-sage py-4 text-center font-semibold text-white shadow-card"
      >
        Ask Sara
      </Link>

      {active ? (
        <button
          type="button"
          className="mt-3 w-full rounded-2xl border border-sage/30 py-3 text-sm font-medium text-sage-deep"
          onClick={finishDiary}
        >
          Finish this diary
        </button>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-0 bottom-6 z-30 mx-auto w-[min(100%-2rem,398px)] rounded-2xl bg-ink px-4 py-3 text-sm text-cream shadow-card"
        >
          {toast}
        </div>
      ) : null}

      {today.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-ink">Recent</h2>
          <ul className="mt-3 space-y-2">
            {today.slice(0, 6).map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-2xl bg-cream-card px-4 py-3 text-sm shadow-card"
              >
                <span className="text-ink">{summarizeLog(entry)}</span>
                <span className="text-ink-faint">{formatTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DrinkSheet
        open={sheet === 'drink'}
        onClose={closeSheet}
        onSave={(entry) => saveLog(entry)}
      />
      <VoidLeakSheet
        open={sheet === 'voidLeak'}
        onClose={closeSheet}
        onSave={(entry) => saveLog(entry)}
      />
      <PadSheet open={sheet === 'pad'} onClose={closeSheet} onSave={(entry) => saveLog(entry)} />
      <ExerciseSheet
        open={sheet === 'exercise'}
        onClose={closeSheet}
        onSave={(entry) => saveLog(entry)}
      />
    </main>
  )
}

function Action({
  label,
  hint,
  onClick,
}: {
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-cream-card px-4 py-4 text-left shadow-card transition hover:ring-2 hover:ring-sage/30"
    >
      <span className="block font-semibold text-ink">{label}</span>
      <span className="mt-1 block text-xs text-ink-mute">{hint}</span>
    </button>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  return 'Evening'
}

function firstName(email: string): string {
  const local = email.split('@')[0] ?? 'friend'
  const piece = local.split(/[._-]/)[0] ?? local
  return piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : 'friend'
}

function DrinkSheet({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (entry: LogEntry) => void
}) {
  const [beverage, setBeverage] = useState('Water')
  const [unit, setUnit] = useState<DrinkVolumeUnit>(() => readDrinkUnit())
  const [ounces, setOunces] = useState(DRINK_OZ_DEFAULT)
  const [milliliters, setMilliliters] = useState(() => ozToMl(DRINK_OZ_DEFAULT))
  const [at, setAt] = useState(toDatetimeLocal())
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) setAt(toDatetimeLocal())
  }, [open])

  const bounds = sliderBounds(unit)
  const sliderValue = unit === 'ml' ? milliliters : ounces
  const volumeLabel = unit === 'ml' ? `${milliliters} ml` : `${ounces} oz`

  const toggleUnit = () => {
    const next: DrinkVolumeUnit = unit === 'oz' ? 'ml' : 'oz'
    if (next === 'ml') setMilliliters(ozToMl(ounces))
    else setOunces(mlToOz(milliliters))
    setUnit(next)
    writeDrinkUnit(next)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: uid(),
      kind: 'drink',
      at: fromDatetimeLocal(at),
      beverage,
      ...drinkEventVolume(sliderValue, unit),
      note: note.trim() || undefined,
    })
  }

  return (
    <BottomSheet open={open} title="Log a drink" subtitle="Whatever you actually had." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {['Water', 'Black or Green Tea', 'Coffee', 'Other'].map((b) => (
            <Chip key={b} label={b} selected={beverage === b} onClick={() => setBeverage(b)} />
          ))}
        </div>
        <Field label="How much">
          <div className="rounded-2xl border border-sage-mist bg-cream px-3.5 py-3">
            <p className="text-center font-serif text-2xl text-ink">{volumeLabel}</p>
            <input
              className="mt-3 w-full accent-sage"
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={sliderValue}
              aria-valuemin={bounds.min}
              aria-valuemax={bounds.max}
              aria-valuenow={sliderValue}
              aria-valuetext={volumeLabel}
              aria-label={unit === 'ml' ? 'Drink volume in milliliters' : 'Drink volume in ounces'}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (unit === 'ml') setMilliliters(next)
                else setOunces(next)
              }}
            />
            <div className="mt-1 flex justify-between text-xs text-ink-faint">
              <span>
                {bounds.min} {unit}
              </span>
              <span>
                {bounds.max} {unit}
              </span>
            </div>
          </div>
        </Field>
        <button
          type="button"
          onClick={toggleUnit}
          className="w-full rounded-full border border-sage/30 py-2.5 text-sm font-medium text-sage-deep"
        >
          {unit === 'oz' ? 'Convert to metric' : 'Convert to ounces'}
        </button>
        <Field label="When">
          <input className={inputClass} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="With lunch…" />
        </Field>
        <button type="submit" className="w-full rounded-full bg-sage py-3 font-semibold text-white">
          Save drink
        </button>
      </form>
    </BottomSheet>
  )
}

function VoidLeakSheet({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (entry: LogEntry) => void
}) {
  const [what, setWhat] = useState<'void' | 'leak' | 'urge'>('void')
  const [intensity, setIntensity] = useState('Light')
  const [at, setAt] = useState(toDatetimeLocal())
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) setAt(toDatetimeLocal())
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: uid(),
      kind: 'voidLeak',
      at: fromDatetimeLocal(at),
      what,
      intensity,
      note: note.trim() || undefined,
    })
  }

  return (
    <BottomSheet
      open={open}
      title="Void (pee) or leak"
      subtitle="Just the facts. Nothing to fix in this moment."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['void', 'Void (pee)'],
              ['leak', 'Leak'],
              ['urge', 'Urge only'],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} label={label} selected={what === id} onClick={() => setWhat(id)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {['Light', 'A lot'].map((i) => (
            <Chip key={i} label={i} selected={intensity === i} onClick={() => setIntensity(i)} />
          ))}
        </div>
        <Field label="When">
          <input className={inputClass} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="What was going on? (optional)">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sneezed, lifting…" />
        </Field>
        <button type="submit" className="w-full rounded-full bg-sage py-3 font-semibold text-white">
          Save
        </button>
      </form>
    </BottomSheet>
  )
}

function PadSheet({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (entry: LogEntry) => void
}) {
  const [reason, setReason] = useState('Damp')
  const [at, setAt] = useState(toDatetimeLocal())

  useEffect(() => {
    if (open) setAt(toDatetimeLocal())
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: uid(),
      kind: 'pad',
      at: fromDatetimeLocal(at),
      reason,
    })
  }

  return (
    <BottomSheet
      open={open}
      title="Pad change"
      subtitle="Time and reason only — that’s enough."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4 pb-2">
        <Field label="When">
          <input className={inputClass} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {['Damp', 'Saturated', 'Other'].map((r) => (
            <Chip key={r} label={r} selected={reason === r} onClick={() => setReason(r)} />
          ))}
        </div>
        <button type="submit" className="w-full rounded-full bg-sage py-3 font-semibold text-white">
          Save change
        </button>
      </form>
    </BottomSheet>
  )
}

function ExerciseSheet({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (entry: LogEntry) => void
}) {
  const [activity, setActivity] = useState('PfilAtes')
  const [minutes, setMinutes] = useState('10')
  const [felt, setFelt] = useState('Just right')
  const [at, setAt] = useState(toDatetimeLocal())

  useEffect(() => {
    if (open) setAt(toDatetimeLocal())
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: uid(),
      kind: 'exercise',
      at: fromDatetimeLocal(at),
      activity,
      minutes,
      felt,
    })
  }

  return (
    <BottomSheet
      open={open}
      title="Exercise"
      subtitle="A set you did is the whole point."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {['PfilAtes', "Kegel's"].map((a) => (
            <Chip key={a} label={a} selected={activity === a} onClick={() => setActivity(a)} />
          ))}
        </div>
        <Field label="Minutes">
          <input className={inputClass} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {['Easy', 'Just right', 'Challenging'].map((f) => (
            <Chip key={f} label={f} selected={felt === f} onClick={() => setFelt(f)} />
          ))}
        </div>
        <Field label="When">
          <input className={inputClass} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <button type="submit" className="w-full rounded-full bg-sage py-3 font-semibold text-white">
          Save exercise
        </button>
      </form>
    </BottomSheet>
  )
}

