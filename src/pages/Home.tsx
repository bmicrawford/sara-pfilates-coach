import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { Chip, Field, inputClass } from '../components/Chip'
import { InstallHint } from '../components/InstallHint'
import { SaraPortrait } from '../components/SaraPortrait'
import {
  DIARY_ACTIVE_CUE,
  DIARY_STARTED_TOAST,
  START_NEW_DIARY_LABEL,
  activeDiary,
  summarizeLog,
} from '../lib/diary'
import { addDiaryLog, finishActiveDiary, readDiaries, readLogs, startNewDiary } from '../lib/mockServer'
import { markCompanionOpened } from '../lib/notifications'
import {
  formatTime,
  fromDatetimeLocal,
  isSameLocalDay,
  toDatetimeLocal,
  uid,
} from '../lib/storage'
import type { Diary, LogEntry, Mood, Session, SheetId } from '../lib/types'

const IDLE_MS = 11_000
const CELEBRATE_MS = 3800

type Props = {
  session: Session
}

export function Home({ session }: Props) {
  const [mood, setMood] = useState<Mood>('default')
  const [sheet, setSheet] = useState<SheetId>(null)
  const [logs, setLogs] = useState<LogEntry[]>(() => readLogs())
  const [diaries, setDiaries] = useState<Diary[]>(() => readDiaries())
  const [smsNote, setSmsNote] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const active = useMemo(() => activeDiary(diaries), [diaries])

  useEffect(() => {
    const evaled = markCompanionOpened()
    if (evaled.wouldSendSms) {
      setSmsNote(
        `Stub SMS: it's been ${evaled.daysSinceOpen.toFixed(0)} days. A real send would check in by text.`,
      )
    }
  }, [])

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
    setLogs(readLogs())
    setSheet(null)
    setMood('celebrate')
    window.setTimeout(() => setMood('default'), CELEBRATE_MS)
  }

  const beginDiary = () => {
    startNewDiary()
    setDiaries(readDiaries())
    setToast(DIARY_STARTED_TOAST)
    setMood('celebrate')
    window.setTimeout(() => setMood('default'), CELEBRATE_MS)
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
          {greeting()}, {firstName(session.email)}.
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

      <section className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Today</p>
        <p className="mt-1 text-sm text-ink">
          {!active
            ? 'Start a diary to log drinks, voids, leaks, pads, and exercise.'
            : today.length === 0
              ? 'Nothing logged yet — whenever you’re ready.'
              : `${counts.drink} drink${counts.drink === 1 ? '' : 's'} · ${counts.voidLeak} void/leak · ${counts.pad} pad · ${counts.exercise} exercise`}
        </p>
      </section>

      {active ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Action label="Log a drink" hint="Sip, glass, tea" onClick={() => openSheet('drink')} />
          <Action label="Void or leak" hint="No judgment" onClick={() => openSheet('voidLeak')} />
          <Action label="Pad change" hint="Time + reason" onClick={() => openSheet('pad')} />
          <Action label="Exercise" hint="A set that happened" onClick={() => openSheet('exercise')} />
        </div>
      ) : (
        <button
          type="button"
          className="mt-5 w-full rounded-2xl bg-sage py-4 text-center font-semibold text-white shadow-card"
          onClick={beginDiary}
        >
          {START_NEW_DIARY_LABEL}
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link
          to="/diary"
          className="rounded-2xl bg-cream-card px-4 py-4 text-left shadow-card transition hover:ring-2 hover:ring-sage/30"
        >
          <span className="block font-semibold text-ink">Bladder diary report</span>
          <span className="mt-1 block text-xs text-ink-mute">
            {active ? 'Open while in progress' : 'Readable before it is finished'}
          </span>
        </Link>
        <Link
          to="/exercise"
          className="rounded-2xl bg-cream-card px-4 py-4 text-left shadow-card transition hover:ring-2 hover:ring-sage/30"
        >
          <span className="block font-semibold text-ink">Exercise log</span>
          <span className="mt-1 block text-xs text-ink-mute">
            {active ? 'Open while in progress' : 'Sessions as you log them'}
          </span>
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
  const [amount, setAmount] = useState('Glass')
  const [at, setAt] = useState(toDatetimeLocal())
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) setAt(toDatetimeLocal())
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: uid(),
      kind: 'drink',
      at: fromDatetimeLocal(at),
      beverage,
      amount,
      note: note.trim() || undefined,
    })
  }

  return (
    <BottomSheet open={open} title="Log a drink" subtitle="Whatever you actually had." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {['Water', 'Herbal tea', 'Coffee', 'Other'].map((b) => (
            <Chip key={b} label={b} selected={beverage === b} onClick={() => setBeverage(b)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {['Sip', 'Glass', 'Bottle'].map((a) => (
            <Chip key={a} label={a} selected={amount === a} onClick={() => setAmount(a)} />
          ))}
        </div>
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
  const [intensity, setIntensity] = useState('Everyday')
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
      title="Void or leak"
      subtitle="Just the facts. Nothing to fix in this moment."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['void', 'Void'],
              ['leak', 'Leak'],
              ['urge', 'Urge only'],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} label={label} selected={what === id} onClick={() => setWhat(id)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {['Light', 'Everyday', 'A lot'].map((i) => (
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
  const [reason, setReason] = useState('Routine')
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
          {['Routine', 'Damp', 'Overnight', 'Heading out', 'Other'].map((r) => (
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
          {['PfilAtes', 'Pelvic floor', 'Walk', 'Stretch', 'Other'].map((a) => (
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

