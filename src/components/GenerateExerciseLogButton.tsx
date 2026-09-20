import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import {
  EXERCISE_GATE_CONTINUE,
  EXERCISE_GATE_QUESTION,
  GENERATE_EXERCISE_LOG_LABEL,
  canExportExerciseLogPdf,
  shouldAskExerciseGate,
  writeExerciseGate,
  type ExerciseGateAnswer,
  type ExerciseGateState,
  type FourWeekExerciseReport,
} from '../lib/exercise'
import {
  DOWNLOAD_PDF_LABEL,
  EXERCISE_PDF_ANYTIME_HINT,
  canBuildExerciseLogPdf,
  exportExerciseLogPdf,
} from '../lib/exercisePdf'

type Props = {
  report: FourWeekExerciseReport
  gate: ExerciseGateState | null
  onGateChange: (gate: ExerciseGateState) => void
  className?: string
}

export function GenerateExerciseLogButton({ report, gate, onGateChange, className }: Props) {
  const [ask, setAsk] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const unlocked = canExportExerciseLogPdf(gate)

  const answerGate = (answer: ExerciseGateAnswer) => {
    const next = writeExerciseGate(answer)
    onGateChange(next)
    setAsk(false)
    setPdfError(null)
  }

  return (
    <div className={className}>
      {unlocked ? (
        <button
          type="button"
          className="w-full rounded-2xl bg-sage py-4 font-semibold text-white shadow-card disabled:opacity-60"
          disabled={pdfBusy}
          onClick={() => {
            if (!canBuildExerciseLogPdf(report, gate)) return
            setPdfError(null)
            setPdfBusy(true)
            void exportExerciseLogPdf(report)
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
      ) : (
        <button
          type="button"
          className="w-full rounded-2xl bg-sage py-4 font-semibold text-white shadow-card"
          onClick={() => {
            if (shouldAskExerciseGate(gate)) setAsk(true)
          }}
        >
          {GENERATE_EXERCISE_LOG_LABEL}
        </button>
      )}

      {gate?.answer === 'no' && !unlocked ? (
        <p role="status" className="mt-3 rounded-2xl bg-sage-mist px-4 py-3 text-sm text-ink">
          {EXERCISE_GATE_CONTINUE}
        </p>
      ) : null}

      <p className="mt-2 text-center text-xs text-ink-mute">
        {unlocked
          ? 'Completion PDF with the PfilAtes logo and www.pfilates.com. You can download it again anytime.'
          : EXERCISE_PDF_ANYTIME_HINT}
      </p>
      {pdfError ? (
        <p role="alert" className="mt-2 text-center text-sm text-ink">
          {pdfError}
        </p>
      ) : null}

      <BottomSheet
        open={ask}
        title="Exercise log"
        subtitle="This question is asked every time you generate until you answer yes."
        onClose={() => setAsk(false)}
      >
        <div className="space-y-4 pb-3">
          <p className="text-sm text-ink">{EXERCISE_GATE_QUESTION}</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl bg-sage py-3 font-semibold text-white"
              onClick={() => answerGate('yes')}
            >
              Yes
            </button>
            <button
              type="button"
              className="rounded-2xl border border-sage/30 py-3 font-semibold text-sage-deep"
              onClick={() => answerGate('no')}
            >
              No
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
