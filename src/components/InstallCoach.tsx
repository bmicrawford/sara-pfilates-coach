import { useEffect, useState } from 'react'
import {
  dismissInstallCoach,
  getDeferredInstallPrompt,
  isIosDevice,
  isStandalone,
  noteStandaloneInstall,
  readInstallCoachStatus,
  runInstallPrompt,
  shouldShowInstallCoach,
  subscribeInstallPrompt,
} from '../lib/installCoach'

const MANUAL_FALLBACK_MS = 1000

export function InstallCoach() {
  const [visible, setVisible] = useState(() => shouldShowInstallCoach())
  const [ios] = useState(() => isIosDevice())
  const [canInstall, setCanInstall] = useState(() => getDeferredInstallPrompt() !== null)
  const [manualReady, setManualReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    noteStandaloneInstall()
    const sync = () => {
      setVisible(shouldShowInstallCoach())
      setCanInstall(getDeferredInstallPrompt() !== null)
    }
    sync()
    const unsubscribe = subscribeInstallPrompt(sync)
    const timer = window.setTimeout(() => setManualReady(true), MANUAL_FALLBACK_MS)
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  if (!visible || isStandalone()) return null
  if (!ios && !canInstall && !manualReady) return null

  const dismiss = () => {
    dismissInstallCoach()
    setVisible(false)
  }

  const install = async () => {
    if (busy) return
    setBusy(true)
    const result = await runInstallPrompt()
    if (result === 'unavailable') {
      setCanInstall(false)
      setManualReady(true)
      setBusy(false)
      return
    }
    setVisible(readInstallCoachStatus() === 'pending' && !isStandalone())
    setCanInstall(getDeferredInstallPrompt() !== null)
    setBusy(false)
  }

  return (
    <section
      aria-label="Add Sara to your Home Screen"
      data-install-coach={ios ? 'ios' : canInstall ? 'install' : 'manual'}
      className="mb-4 rounded-2xl border border-sage/20 bg-cream-card px-4 py-3 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-black">Put Sara on your Home Screen</h2>
        <button type="button" onClick={dismiss} className="shrink-0 text-sm font-medium text-black">
          Not now
        </button>
      </div>
      {ios ? (
        <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-black">
          <li className="font-semibold">Share</li>
          <li aria-hidden="true">→</li>
          <li className="font-semibold">Add to Home Screen</li>
          <li aria-hidden="true">→</li>
          <li className="font-semibold">Add</li>
        </ol>
      ) : canInstall ? (
        <>
          <p className="mt-1 text-sm text-black">One tap. No app store.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void install()
            }}
            className="mt-3 w-full rounded-full bg-sage py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            Install
          </button>
        </>
      ) : (
        <p className="mt-2 text-sm text-black">
          Open the Chrome menu, then <span className="font-semibold">Add to Home screen</span> or{' '}
          <span className="font-semibold">Install app</span>.
        </p>
      )}
    </section>
  )
}
