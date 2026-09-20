import { useState } from 'react'
import type { BladderDiaryReport } from '../lib/diary'
import {
  DOWNLOAD_PDF_ANYTIME_HINT,
  DOWNLOAD_PDF_LABEL,
  canExportBladderDiaryPdf,
  exportBladderDiaryPdf,
} from '../lib/diaryPdf'

type Props = {
  report: BladderDiaryReport
  className?: string
}

export function DownloadDiaryPdfButton({ report, className }: Props) {
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  return (
    <div className={className}>
      <button
        type="button"
        className="w-full rounded-2xl bg-sage py-4 font-semibold text-white shadow-card disabled:opacity-60"
        disabled={pdfBusy}
        onClick={() => {
          if (!canExportBladderDiaryPdf(report)) return
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
      <p className="mt-2 text-center text-xs text-ink-mute">{DOWNLOAD_PDF_ANYTIME_HINT}</p>
      {pdfError ? (
        <p role="alert" className="mt-2 text-center text-sm text-ink">
          {pdfError}
        </p>
      ) : null}
    </div>
  )
}
