import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  )
}

export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('sara.hideInstall') === '1')
  const [iosTip, setIosTip] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    setIosTip(isIos())
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (hidden || isStandalone()) return null
  if (!deferred && !iosTip) return null

  const dismiss = () => {
    sessionStorage.setItem('sara.hideInstall', '1')
    setHidden(true)
  }

  return (
    <div className="mb-4 rounded-2xl border border-sage/20 bg-cream-card px-4 py-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">Keep Sara on your home screen</p>
          {deferred ? (
            <p className="mt-1 text-sm text-ink-mute">
              Add this companion like an app — no store, no password.
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-mute">
              On iPhone: tap Share, then <span className="font-medium text-ink">Add to Home Screen</span>.
            </p>
          )}
        </div>
        <button type="button" onClick={dismiss} className="text-sm text-ink-faint">
          Not now
        </button>
      </div>
      {deferred ? (
        <button
          type="button"
          className="mt-3 w-full rounded-full bg-sage py-2.5 text-sm font-semibold text-white"
          onClick={async () => {
            await deferred.prompt()
            await deferred.userChoice
            setDeferred(null)
            dismiss()
          }}
        >
          Add to home screen
        </button>
      ) : null}
    </div>
  )
}
