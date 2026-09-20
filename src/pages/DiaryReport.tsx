import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PfilatesBrandHeader } from '../components/PfilatesLogo'
import { DiaryPicker, ReportShell } from '../components/ReportShell'
import {
  BLADDER_TOTAL_FIELDS,
  START_NEW_DIARY_LABEL,
  bladderDiaryReport,
  canViewDiaryReport,
  isDiaryOpen,
  latestDiary,
  summarizeLog,
  type DiaryDayReport,
} from '../lib/diary'
import {
  DOWNLOAD_PDF_LABEL,
  DIARY_REPORT_EMPTY,
  bladderDiaryReportSubtitle,
  exportBladderDiaryPdf,
  incompleteDayLabel,
} from '../lib/diaryPdf'
import { finishActiveDiary, readDiaries, readLogs, startNewDiary, syncDiaryWindows } from '../lib/mockServer'
import { formatDateOfBirth, readPatient } from '../lib/patient'
import { formatDay, formatTime } from '../lib/storage'

export function DiaryReport() {
  const navigate = useNavigate()
  const [diaries, setDiaries] = useState(() => syncDiaryWindows())
  const [logs] = useState(() => readLogs())
  const [selectedId, setSelectedId] = useState(() => latestDiary(readDiaries())?.id ?? null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const selected = diaries.find((diary) => diary.id === selectedId) ?? latestDiary(diaries)
  const patient = readPatient()

  const report = useMemo(
    () => (selected ? bladderDiaryReport(selected, logs, { patient }) : null),
    [selected, logs, patient],
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

  return (
    <ReportShell
      title="Bladder diary report"
      status={report.status}
      subtitle={bladderDiaryReportSubtitle(report)}
    >
      <PfilatesBrandHeader />

      <section className="mb-5 rounded-2xl bg-cream-card px-4 py-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-ink-faint">Patient</p>
        <p className="mt-1 font-serif text-xl text-ink">{report.patientName}</p>
        <p className="mt-1 text-sm text-ink">
          Date of birth{' '}
          {report.dateOfBirth.includes('-') && report.dateOfBirth.length === 10
            ? formatDateOfBirth(report.dateOfBirth)
            : report.dateOfBirth}
        </p>
      </section>

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

      <section className="space-y-4">
        {report.days.map((day) => (
          <DayCard key={day.day} day={day} />
        ))}
      </section>

      {report.entries.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-cream-card px-4 py-4 text-sm text-ink shadow-card">
          {DIARY_REPORT_EMPTY}
        </p>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="font-serif text-lg text-ink">Logged events</h2>
          <ul className="space-y-2">
            {report.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-2xl bg-cream-card px-4 py-3 text-sm shadow-card"
              >
                <span className="text-ink">{summarizeLog(entry)}</span>
                <span className="text-ink-faint">{formatTime(entry.at)}</span>
              </li>
            ))}
          </ul>
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

function DayCard({ day }: { day: DiaryDayReport }) {
  const badge = incompleteDayLabel(day)
  return (
    <section className="rounded-2xl bg-cream-card px-4 py-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-ink">{day.label}</h2>
        {badge ? (
          <span className="rounded-full bg-sage-mist px-3 py-1 text-xs font-medium text-sage-deep">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {BLADDER_TOTAL_FIELDS.map((field) => (
          <Stat key={field.key} label={field.label} value={day[field.key]} />
        ))}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-cream px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink">{value}</p>
    </div>
  )
}

