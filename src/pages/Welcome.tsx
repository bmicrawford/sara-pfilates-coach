import { Link } from 'react-router-dom'
import { SaraPortrait } from '../components/SaraPortrait'
import { DEMO_TOKEN } from '../lib/mockServer'

export function Welcome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-10 safe-top">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-sage-deep">
        PfilAtes companion
      </p>
      <div className="mt-8">
        <SaraPortrait mood="default" />
      </div>
      <p className="mt-3 text-center text-ink-mute">
        Your course stays on Kajabi. This is the quiet pocket version — log a sip,
        a leak, a class. No password. Just your email, once.
      </p>
      <div className="mt-auto space-y-3 pt-8">
        <Link
          to={`/r/${DEMO_TOKEN}`}
          className="block rounded-full bg-sage py-3.5 text-center text-base font-semibold text-white shadow-card"
        >
          Redeem a demo pass
        </Link>
        <p className="text-center text-xs text-ink-faint">
          Opens <span className="font-medium text-ink-mute">/r/{DEMO_TOKEN}</span>
        </p>
      </div>
    </main>
  )
}
