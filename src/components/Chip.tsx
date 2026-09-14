import type { ReactNode } from 'react'

type Props = {
  label: string
  selected?: boolean
  onClick: () => void
}

export function Chip({ label, selected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm transition ${
        selected
          ? 'bg-sage text-white shadow-sm'
          : 'bg-sage-mist text-ink hover:bg-sage/20'
      }`}
    >
      {label}
    </button>
  )
}

type FieldProps = {
  label: string
  children: ReactNode
}

export function Field({ label, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink-mute">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-2xl border border-sage-mist bg-cream px-3.5 py-3 text-ink outline-none ring-sage/30 placeholder:text-ink-faint focus:ring-2'
