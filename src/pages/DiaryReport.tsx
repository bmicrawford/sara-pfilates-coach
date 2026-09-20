import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DiaryPicker, ReportShell } from '../components/ReportShell'
import {
  START_NEW_DIARY_LABEL,
  bladderDiaryReport,
  canViewDiaryReport,
  groupLogsByDay,
  isDiaryOpen,
  latestDiary,
  summarizeLog,
} from '../lib/diary'
import {
  DOWNLOAD_PDF_LABEL,
  DIARY_REPORT_EMPTY,
  bladderDiaryReportSubtitle,
  exportBladderDiaryPdf,
} from '../lib/diaryPdf'
import { finishActiveDiary, readDiaries, readLogs, startNewDiary } from '../lib/mockServer'
import { formatDay, formatTime } from '../lib/storage'

export function DiaryReport() {
  const navigate = useNavigate()
  const [diaries, setDiaries] = useState(() => readDiaries())
  const [logs] = useState(() => readLogs())
  const [selectedId, setSelectedId] = useState(() => latestDiary(readDiaries())?.id ?? null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const selected = diaries.find((diary) => diary.id === selectedId) ?? latestDiary(diaries)

  const report = useMemo(
    () => (selected ? bladderDiaryReport(selected, logs) : null),
    [selected, logs],
  )

  const picker = diaries.map((diary) => ({
    id: diary.id,
    label: `${isDiaryOpen(diary) ? 'In progress' : 'Finished'} · ${formatDay(diary.startedAt)}`,
  }))

  if (!canViewDiaryReport(selected) || !report) {
    return (
      <ReportShell title="Bladder diary report" status="empty" subtitle="Available as soon as a diary is started — including while it is still in progress.">
        <p className="rounded-2xl bg-cream-card px-4 py-4 text-sm text-ink shadow-card">
          No diary yet. Start one from Home, then keep this report open while you log.
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
      title="Bladder diary report"
      status={report.status}
      subtitle={bladderDiaryReportSubtitle(report)}
    >
      <DiaryPicker diaries={picker} selectedId={selected.id} onSelect={setSelectedId} />

      <button
        type="button"
        className="mb-5 w-full rounded-2xl bg-sage py-4 font-semibold text-white shadow-card disabled:opacity-60"
        disabled={pdfBusy}
        onClick={() => {
          setPdfError(null)
          setPdfBusy(true)
          void exportBladderDiaryPdf(report)
            .catch(() => {
              setPdfError('Could not prepare the PDF. Try again.')
            })
            .finally(() => {
              setPdfBusy(false)
            })
        }}
      >
        {pdfBusy ? 'Preparing PDF…' : DOWNLOAD_PDF_LABEL}
      </button>
      {pdfError ? (
        <p role="alert" className="mb-5 text-center text-sm text-ink">
          {pdfError}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <Stat label="Drinks" value={report.drinks} />
        <Stat label="Voids" value={report.voids} />
        <Stat label="Leaks" value={report.leaks} />
        <Stat label="Urges" value={report.urges} />
        <Stat label="Pad changes" value={report.pads} />
      </section>

      {report.entries.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-cream-card px-4 py-4 text-sm text-ink shadow-card">
          {DIARY_REPORT_EMPTY}
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
                    <span className="text-ink">{summarizeLog(entry)}</span>
                    <span className="text-ink-faint">{formatTime(entry.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <Link to="/exercise" className="mt-6 block text-center text-sm font-medium text-sage-deep">
        Exercise log
      </Link>

      {report.status === 'in_progress' ? (
        <button
          type="button"
          className="mt-3 w-full rounded-2xl border border-sage/30 py-3 text-sm font-medium text-sage-deep"
          onClick={() => {
            finishActiveDiary()
            setDiaries(readDiaries())
          }}
        >
          Finish this diary
        </button>
      ) : (
        <p className="mt-4 text-center text-xs text-ink-faint">
          Finished diaries stay readable. Start another from Home when you want a new one.
        </p>
      )}
    </ReportShell>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink">{value}</p>
    </div>
  )
}
