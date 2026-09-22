import { FormEvent, useMemo, useState } from 'react'
import { Field, inputClass } from '../components/Chip'
import { InstallCoach } from '../components/InstallCoach'
import { SaraPortrait } from '../components/SaraPortrait'
import { readPatient, savePatient } from '../lib/patient'

export function PatientOnboarding() {
  const existing = useMemo(() => readPatient(), [])
  const [name, setName] = useState(existing?.name ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(existing?.dateOfBirth ?? '')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      savePatient({ name, dateOfBirth })
    } catch {
      setError('Add your name and date of birth so the doctor report can be labeled. We only ask once.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-10 safe-top">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
        Your details
      </p>
      <div className="mt-8">
        <SaraPortrait mood="default" />
      </div>
      <p className="mt-3 text-center text-ink-mute">
        We save your name and date of birth on this phone so the bladder diary report is labeled for
        your doctor. We only ask once.
      </p>
      <div className="mt-6">
        <InstallCoach />
      </div>
      <form onSubmit={onSubmit} className="mt-2 space-y-4">
        <Field label="Name">
          <input
            className={inputClass}
            autoComplete="name"
            placeholder="Name as it should appear"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Date of birth">
          <input
            className={inputClass}
            type="date"
            autoComplete="bday"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            required
          />
        </Field>
        {error ? <p className="text-sm text-[#9a5b4a]">{error}</p> : null}
        <button type="submit" className="w-full rounded-full bg-sage py-3.5 font-semibold text-white shadow-card">
          Save and continue
        </button>
      </form>
    </main>
  )
}
