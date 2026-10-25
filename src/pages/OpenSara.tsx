import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field, inputClass } from '../components/Chip'
import { SaraPortrait } from '../components/SaraPortrait'
import { redeemToken } from '../lib/mockServer'
import { openEmailFromSearch, openSaraAccess, SARA_OPEN_WAITING } from '../lib/openSara'

export function OpenSara() {
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => openEmailFromSearch(window.location.search))
  const [phase, setPhase] = useState<'checking' | 'waiting'>(() =>
    openEmailFromSearch(window.location.search) ? 'checking' : 'waiting',
  )

  useEffect(() => {
    const initial = openEmailFromSearch(window.location.search)
    if (!initial) return
    void attempt(initial)
    // The welcome link is checked once. Retry is the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function attempt(value: string) {
    const next = value.trim()
    if (!next.includes('@')) {
      setPhase('waiting')
      return
    }
    setPhase('checking')
    const opened = await openSaraAccess(next)
    if (opened.ready) {
      const redeemed = await redeemToken(opened.token, opened.email)
      if (redeemed.ok) {
        navigate('/', { replace: true })
        return
      }
    }
    setPhase('waiting')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (phase === 'checking') return
    void attempt(email)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-10 safe-top">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
        Open Sara
      </p>
      <div className="mt-8">
        <SaraPortrait mood="default" />
      </div>
      {phase === 'waiting' ? <p className="mt-3 text-center text-ink-mute">{SARA_OPEN_WAITING}</p> : null}
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field label="Purchase email">
          <input
            className={inputClass}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <button
          type="submit"
          disabled={phase === 'checking'}
          className="w-full rounded-full bg-sage py-3.5 font-semibold text-white shadow-card disabled:opacity-60"
        >
          {phase === 'checking' ? 'Checking…' : 'Try again'}
        </button>
      </form>
    </main>
  )
}
