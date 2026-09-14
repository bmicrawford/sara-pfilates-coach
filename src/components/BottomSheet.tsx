import { useEffect } from 'react'
import type { ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

export function BottomSheet({ open, title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-[430px] rounded-t-3xl bg-cream-card shadow-sheet safe-bottom">
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-sage-mist" />
        </div>
        <div className="px-5 pb-2 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-ink">{title}</h2>
              {subtitle ? <p className="mt-1 text-sm text-ink-mute">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-sm text-ink-mute hover:bg-cream"
            >
              Close
            </button>
          </div>
        </div>
        <div className="px-5 pb-2">{children}</div>
      </div>
    </div>
  )
}
