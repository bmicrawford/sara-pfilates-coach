import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SaraPortrait } from '../components/SaraPortrait'
import { Field, inputClass } from '../components/Chip'
import { isDemoPass } from '../lib/demoPass'
import { demoStreamSnapshot, holdDemoStream } from '../lib/demoStreamSession'
import type { DemoWarmPhase } from '../lib/demoStreamWarm'
import { preloadSaraStream, setSaraStreamPassOverride } from '../lib/saraStream'
import { DEMO_TOKEN, normalizeToken, redeemDemoPass, redeemToken } from '../lib/mockServer'
import { PROSPECT_REDEEM_NOTE, redeemAsksForEmail } from '../lib/prospectCopy'
import { captureSaraDebug, withSaraDebug } from '../lib/saraDebug'

export function Redeem() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const displayToken = useMemo(() => normalizeToken(token), [token])
  const prospect = isDemoPass(displayToken)
  const [warmPhase, setWarmPhase] = useState<DemoWarmPhase>(
    () => (prospect ? demoStreamSnapshot()?.phase ?? 'idle' : 'idle'),
  )
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [bound, setBound] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    captureSaraDebug(window.location.search)
  }, [])

  useEffect(() => {
    if (!prospect) return
    setSaraStreamPassOverride(displayToken)
    preloadSaraStream()
    const release = holdDemoStream((snap) => setWarmPhase(snap.phase))
    return () => {
      setSaraStreamPassOverride('')
      release()
    }
  }, [prospect, displayToken])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBound(false)
    if (redeemAsksForEmail(prospect)) {
      if (!email.includes('@')) {
        setError('Use the email from your Kajabi receipt.')
        return
      }
    }
    setBusy(true)
    try {
      const result = prospect
        ? await redeemDemoPass()
        : await redeemToken(displayToken || DEMO_TOKEN, email)
      if (result.ok) {
        navigate(withSaraDebug('/'), { replace: true })
        return
      }
      if (result.reason === 'unknown-token') {
        setError('That pass isn’t recognized. Open the private link from your purchase email.')
        return
      }
      if (result.reason === 'email-mismatch') {
        setError('This pass is already tied to a different email. Use the email from your Kajabi receipt.')
        return
      }
      if (result.reason === 'redeem-unavailable') {
        setError('Sara couldn’t check this pass just now. Try again in a moment.')
        return
      }
      if (result.reason === 'invalid') {
        setError('Use the email from your Kajabi receipt.')
        return
      }
      setBound(true)
      setError('This pass is already living on another phone.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-10 safe-top">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
        Redeem your companion
      </p>
      <div className="mt-8">
        <SaraPortrait
          mood={bound ? 'neutral' : 'default'}
          preparing={prospect && warmPhase === 'connecting'}
          motion={prospect}
        />
      </div>
      <p className="mt-3 text-center text-ink-mute">
        {prospect
          ? PROSPECT_REDEEM_NOTE
          : 'Email only — no password, no Kajabi login here. We’ll bind this phone so Sara stays in one place.'}
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field label="Redeem pass">
          <input className={inputClass} value={displayToken} readOnly />
        </Field>
        {redeemAsksForEmail(prospect) ? (
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
        ) : null}
        {error ? <p className="text-sm text-[#9a5b4a]">{error}</p> : null}
        {bound ? (
          <Link to="/move" className="block text-center text-sm font-medium text-sage-deep underline">
            Move Sara to this phone
          </Link>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-sage py-3.5 font-semibold text-white shadow-card disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </main>
  )
}
