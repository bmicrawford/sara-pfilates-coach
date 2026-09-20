import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GenerateExerciseLogButton } from '../components/GenerateExerciseLogButton'
import { PfilatesBrandHeader } from '../components/PfilatesLogo'
import { ReportShell } from '../components/ReportShell'
import {
  EXERCISE_ATTESTED_NOTE,
  EXERCISE_DURATION_LABEL,
  EXERCISE_FREQUENCY_LABEL,
  EXERCISE_REPORT_EMPTY,
  EXERCISE_REPORT_TITLE,
  exerciseDayLines,
  exerciseDurationLabel,
  exerciseFrequencyLabel,
  fourWeekExerciseReport,
  readExerciseGate,
} from '../lib/exercise'
import { exerciseLogReportSubtitle } from '../lib/exercisePdf'
import { readLogs } from '../lib/mockServer'
import { formatDateOfBirth, readPatient } from '../lib/patient'
import { formatDay } from '../lib/storage'

export function ExerciseLog() {
  const [logs] = useState(() => readLogs())
  const [gate, setGate] = useState(() => readExerciseGate())
  const patient = readPatient()
  const report = useMemo(() => fourWeekExerciseReport(logs, { patient, gate }), [logs, patient, gate])

  return (
    <ReportShell title={EXERCISE_REPORT_TITLE} subtitle={exerciseLogReportSubtitle(report)}>
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

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
          <p className="text-xs uppercase tracking-wide text-ink-faint">{EXERCISE_DURATION_LABEL}</p>
          <p className="mt-1 font-serif text-2xl text-ink">{exerciseDurationLabel(report)}</p>
        </div>
        <div className="rounded-2xl bg-cream-card px-4 py-3 shadow-card">
          <p className="text-xs uppercase tracking-wide text-ink-faint">{EXERCISE_FREQUENCY_LABEL}</p>
          <p className="mt-1 font-serif text-lg leading-snug text-ink">{exerciseFrequencyLabel(report)}</p>
        </div>
      </section>

      <GenerateExerciseLogButton report={report} gate={gate} onGateChange={setGate} className="mt-5" />

      {report.imputed ? (
        <p className="mt-3 rounded-2xl bg-sage-mist px-4 py-3 text-sm text-ink">{EXERCISE_ATTESTED_NOTE}</p>
      ) : null}

      {report.days.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-cream-card px-4 py-4 text-sm text-ink shadow-card">
          {EXERCISE_REPORT_EMPTY}
        </p>
      ) : (
        <section className="mt-6 space-y-5">
          {report.days.map((group) => (
            <div key={group.day}>
              <h2 className="font-serif text-lg text-ink">{formatDay(group.dayAt)}</h2>
              <p className="mt-1 text-xs text-ink-faint">
                {EXERCISE_DURATION_LABEL} {group.minutes} min · {EXERCISE_FREQUENCY_LABEL} {group.sessions}{' '}
                {group.sessions === 1 ? 'session' : 'sessions'}
              </p>
              <ul className="mt-2 space-y-2">
                {exerciseDayLines(group).map((line, index) => (
                  <li
                    key={`${group.day}-${line.source}-${index}`}
                    className="flex items-center justify-between rounded-2xl bg-cream-card px-4 py-3 text-sm shadow-card"
                  >
                    <span className="text-ink">
                      {line.text}
                      {line.felt ? ` · ${line.felt}` : ''}
                    </span>
                    <span className="text-ink-faint">{line.time}</span>
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
