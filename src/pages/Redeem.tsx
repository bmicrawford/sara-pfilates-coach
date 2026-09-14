import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SaraPortrait } from '../components/SaraPortrait'
import { Field, inputClass } from '../components/Chip'
import { DEMO_TOKEN, normalizeToken, redeemToken } from '../lib/mockServer'

export function Redeem() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const displayToken = useMemo(() => normalizeToken(token), [token])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [bound, setBound] = useState(false)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBound(false)
    if (!email.includes('@')) {
      setError('Use the email from your Kajabi receipt.')
      return
    }
    const result = redeemToken(displayToken || DEMO_TOKEN, email)
    if (result.ok) {
      navigate('/', { replace: true })
      return
    }
    if (result.reason === 'unknown-token') {
      setError('That pass isn’t recognized. Try the demo token DEMO-SARA-001.')
      return
    }
    setBound(true)
    setError('This pass is already living on another phone.')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-10 safe-top">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
        Redeem your companion
      </p>
      <div className="mt-8">
        <SaraPortrait mood={bound ? 'neutral' : 'default'} />
      </div>
      <p className="mt-3 text-center text-ink-mute">
        Email only — no password, no Kajabi login here. We’ll bind this phone so
        Sara stays in one place.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field label="Redeem pass">
          <input className={inputClass} value={displayToken} readOnly />
        </Field>
        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        {error ? <p className="text-sm text-[#9a5b4a]">{error}</p> : null}
        {bound ? (
          <Link to="/move" className="block text-center text-sm font-medium text-sage-deep underline">
            Move Sara to this phone
          </Link>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-full bg-sage py-3.5 font-semibold text-white shadow-card"
        >
          Continue
        </button>
      </form>
    </main>
  )
}
