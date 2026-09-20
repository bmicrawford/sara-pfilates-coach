import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { DiaryViewStatus } from '../lib/types'

type Props = {
  title: string
  subtitle?: string
  status?: DiaryViewStatus | 'empty'
  children: ReactNode
}

export function ReportShell({ title, subtitle, status, children }: Props) {
  return (
    <main className="mx-auto min-h-dvh max-w-[430px] px-5 pb-12 safe-top">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="text-sm text-ink-mute hover:text-ink">
          ← Home
        </Link>
        {status === 'in_progress' ? (
          <span className="rounded-full bg-sage-mist px-3 py-1 text-xs font-medium text-sage-deep">
            In progress
          </span>
        ) : status === 'completed' ? (
          <span className="rounded-full bg-cream-card px-3 py-1 text-xs font-medium text-ink-mute shadow-card">
            Finished
          </span>
        ) : null}
      </header>
      <h1 className="mt-6 font-serif text-3xl text-ink">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-ink-mute">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </main>
  )
}

export function DiaryPicker({
  diaries,
  selectedId,
  onSelect,
}: {
  diaries: { id: string; label: string }[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  if (diaries.length <= 1) return null
  return (
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
      {diaries.map((diary) => {
        const selected = diary.id === selectedId
        return (
          <button
            key={diary.id}
            type="button"
            onClick={() => onSelect(diary.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
              selected ? 'bg-sage text-white' : 'bg-sage-mist text-ink'
            }`}
          >
            {diary.label}
          </button>
        )
      })}
    </div>
  )
}
