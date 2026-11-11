import { useEffect, useState } from 'react'
import { AI_COACH_LINE } from '../lib/movements'
import { readReminderTime } from '../lib/movementPlan'
import {
  REMINDER_BODY,
  detectedTimeZone,
  disableReminder,
  fetchVapidPublicKey,
  loadReminder,
  reminderEmail,
  reminderProblem,
  saveReminder,
  subscribeForReminder,
  timeZoneOptions,
} from '../lib/reminders'

export function DailyReminder() {
  const email = reminderEmail()
  const zones = timeZoneOptions()
  const [enabled, setEnabled] = useState(false)
  const [time, setTime] = useState(() => readReminderTime() ?? '08:00')
  const [timeZone, setTimeZone] = useState(() => detectedTimeZone())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [suppressed, setSuppressed] = useState(false)

  useEffect(() => {
    if (!email) return
    let cancel = false
    void loadReminder(email).then((view) => {
      if (cancel || !view) return
      setEnabled(view.enabled)
      setSuppressed(view.suppressed === true)
      if (view.time) setTime(view.time)
      if (view.timeZone) setTimeZone(view.timeZone)
    })
    return () => {
      cancel = true
    }
  }, [email])

  const turnOn = async () => {
    if (!email || busy) return
    setBusy(true)
    setNote(null)
    const publicKey = await fetchVapidPublicKey(email)
    if (typeof publicKey !== 'string') {
      setEnabled(false)
      setNote(reminderProblem(publicKey.error))
      setBusy(false)
      return
    }
    const subscription = await subscribeForReminder(publicKey)
    if ('error' in subscription) {
      setEnabled(false)
      setNote(reminderProblem(subscription.error))
      setBusy(false)
      return
    }
    const saved = await saveReminder({ email, time, timeZone, subscription })
    if (!saved.ok) {
      setEnabled(false)
      setSuppressed(saved.error === 'suppressed')
      setNote(reminderProblem(saved.error))
      setBusy(false)
      return
    }
    setEnabled(true)
    setNote('On. You can turn this off anytime.')
    setBusy(false)
  }

  const turnOff = async () => {
    if (!email || busy) return
    setBusy(true)
    const ok = await disableReminder(email)
    setEnabled(false)
    setNote(ok ? 'Off. Nothing will be sent.' : reminderProblem('save_failed'))
    setBusy(false)
  }

  return (
    <section className="mt-4" aria-label="Daily reminder">
      <h3 className="text-sm font-bold text-black">Daily reminder</h3>
      <p className="mt-1 text-xs font-bold leading-relaxed text-black">
        Off until you turn it on. Nothing is sent while it is off.
      </p>
      <label className="mt-3 block text-sm font-bold text-black">
        Time
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="mt-1.5 min-h-11 w-full rounded-2xl border border-black/15 bg-white/75 px-3 text-base font-bold text-black"
        />
      </label>
      <label className="mt-3 block text-sm font-bold text-black">
        Time zone
        <select
          value={zones.includes(timeZone) ? timeZone : zones[0]}
          onChange={(event) => setTimeZone(event.target.value)}
          className="mt-1.5 min-h-11 w-full rounded-2xl border border-black/15 bg-white/75 px-3 text-base font-bold text-black"
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-3 text-xs font-bold leading-relaxed text-black">The reminder says: {REMINDER_BODY}</p>
      <p className="mt-1 text-xs font-bold leading-relaxed text-black">{AI_COACH_LINE}</p>
      {suppressed ? (
        <p className="mt-2 text-xs font-bold leading-relaxed text-black" role="status">
          This email is on the do-not-contact list. No reminder will be sent.
        </p>
      ) : null}
      {note ? (
        <p className="mt-2 text-xs font-bold leading-relaxed text-black" role="status">
          {note}
        </p>
      ) : null}
      {enabled ? (
        <button
          type="button"
          onClick={() => void turnOff()}
          disabled={busy || !email}
          className="mt-3 min-h-11 w-full rounded-full border border-black/20 bg-white/70 py-2 text-sm font-bold text-black disabled:opacity-40"
        >
          Turn reminder off
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void turnOn()}
          disabled={busy || !email || suppressed}
          className="mt-3 min-h-11 w-full rounded-full bg-sage py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Turn reminder on
        </button>
      )}
    </section>
  )
}
