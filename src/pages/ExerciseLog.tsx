import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DiaryPicker, ReportShell } from '../components/ReportShell'
import {
  START_NEW_DIARY_LABEL,
  canViewDiaryReport,
  exerciseLogReport,
  groupLogsByDay,
  isDiaryOpen,
  latestDiary,
  summarizeLog,
} from '../lib/diary'
import { readDiaries, readLogs, startNewDiary } from '../lib/mockServer'
import { formatDay, formatTime } from '../lib/storage'

export function ExerciseLog() {
  const navigate = useNavigate()
  const [diaries] = useState(() => readDiaries())
  const [logs] = useState(() => readLogs())
  const [selectedId, setSelectedId] = useState(() => latestDiary(readDiaries())?.id ?? null)
  const selected = diaries.find((diary) => diary.id === selectedId) ?? latestDiary(diaries)

  const report = useMemo(
    () => (selected ? exerciseLogReport(selected, logs) : null),
    [selected, logs],
  )

  const picker = diaries.map((diary) => ({
    id: diary.id,
    label: `${isDiaryOpen(diary) ? 'In progress' : 'Finished'} · ${formatDay(diary.startedAt)}`,
  }))

  if (!canViewDiaryReport(selected) || !report) {
    return (
      <ReportShell
        title="Exercise log"
        status="empty"
        subtitle="Sessions show here as you log them — including while a diary is still in progress."
      >
        <p className="rounded-2xl bg-cream-card px-4 py-4 text-sm text-ink shadow-card">
          No diary yet. Start one from Home, then log a session when it happens.
        </p>
        <button
          type="button"
          className="mt-4 w-full rounded-2xl bg-sage py-4 font-semibold text-white shadow-card"
          onClick={() => {
            startNewDiary()
            navigate('/')
          }}
        >
          {START_NEW_DIARY_LABEL}
        </button>
      </ReportShell>
    )
  }

  const grouped = groupLogsByDay(report.entries)

  return (
    <ReportShell
      title="Exercise log"
      status={report.status}
      subtitle={
        report.status === 'in_progress'
          ? `Started ${formatDay(report.startedAt)}. This log is readable while the diary is still open.`
          : `Started ${formatDay(report.startedAt)}${report.completedAt ? ` · finished ${formatDay(report.completedAt)}` : ''}.`
      }
    >
      <DiaryPicker diaries={picker} selectedId={selected.id} onSelect={setSelectedId} />

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Sessions</p>
          <p className="mt-1 font-serif text-2xl text-ink">{report.sessions}</p>
        </div>
        <div className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Minutes</p>
          <p className="mt-1 font-serif text-2xl text-ink">{report.minutes}</p>
        </div>
      </section>

      {report.entries.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-cream-card px-4 py-4 text-sm text-ink shadow-card">
          No sessions logged yet. You can open this log while the diary is still in progress.
        </p>
      ) : (
        <section className="mt-6 space-y-5">
          {grouped.map((group) => (
            <div key={group.day}>
              <h2 className="font-serif text-lg text-ink">{formatDay(group.items[0]?.at ?? group.day)}</h2>
              <ul className="mt-2 space-y-2">
                {group.items.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between rounded-2xl bg-cream-card px-4 py-3 text-sm shadow-card"
                  >
                    <span className="text-ink">
                      {summarizeLog(entry)}
                      {entry.felt ? ` · ${entry.felt}` : ''}
                    </span>
                    <span className="text-ink-faint">{formatTime(entry.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <Link to="/diary" className="mt-6 block text-center text-sm font-medium text-sage-deep">
        Bladder diary report
      </Link>
    </ReportShell>
  )
}
