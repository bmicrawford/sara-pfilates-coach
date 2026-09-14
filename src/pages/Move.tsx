import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Field, inputClass } from '../components/Chip'
import { SaraPortrait } from '../components/SaraPortrait'
import { DEMO_TOKEN, releaseBinding, simulateNewPhone } from '../lib/mockServer'

export function Move() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const ok = releaseBinding(email)
    if (!ok) {
      setError('No binding found for that email on this prototype server.')
      return
    }
    setDone(true)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-10 safe-top">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
        New phone
      </p>
      <div className="mt-8">
        <SaraPortrait mood={done ? 'default' : 'neutral'} />
      </div>
      <p className="mt-3 text-center text-ink-mute">
        Stub only. Confirm the email you redeemed with and we’ll release the old
        device so you can bind this one.
      </p>
      {done ? (
        <div className="mt-8 space-y-4">
          <p className="rounded-2xl bg-sage-mist px-4 py-3 text-sm text-ink">
            Released. Redeem again on this phone to keep going.
          </p>
          <button
            type="button"
            className="w-full rounded-full bg-sage py-3.5 font-semibold text-white"
            onClick={() => navigate(`/r/${DEMO_TOKEN}`)}
          >
            Redeem on this phone
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field label="Email on the old phone">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          {error ? <p className="text-sm text-[#9a5b4a]">{error}</p> : null}
          <button type="submit" className="w-full rounded-full bg-sage py-3.5 font-semibold text-white">
            Release the old phone
          </button>
          <button
            type="button"
            className="w-full rounded-full border border-sage/30 py-3 text-sage-deep"
            onClick={() => {
              simulateNewPhone()
              navigate(`/r/${DEMO_TOKEN}`)
            }}
          >
            Pretend this is a new phone
          </button>
          <Link to="/" className="block text-center text-sm text-ink-mute">
            Never mind
          </Link>
        </form>
      )}
    </main>
  )
}
