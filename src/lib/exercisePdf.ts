import { PFILATES_BRAND, PFILATES_SITE, localDayKey, summarizeLog } from './diary.ts'
import {
  DOWNLOAD_PDF_LABEL,
  PFILATES_LOGO_SRC,
  deliverPdfBlob,
  downscaleLogoForPdf,
  pdfSafe,
  pfilatesLogoDataUrl,
} from './diaryPdf.ts'
import {
  EXERCISE_REPORT_EMPTY,
  EXERCISE_REPORT_TITLE,
  canExportExerciseLogPdf,
  exerciseDurationLabel,
  exerciseFrequencyLabel,
  type ExerciseGateState,
  type FourWeekExerciseReport,
} from './exercise.ts'
import { formatDateOfBirth } from './patient.ts'
import { formatDay, formatTime } from './storage.ts'

export { DOWNLOAD_PDF_LABEL, PFILATES_LOGO_SRC }

export const EXERCISE_PDF_ANYTIME_HINT =
  'Answer the 4-week question each time you generate. The completion PDF is offered only after Yes.'

export type ExercisePdfStat = { label: string; value: string }

export type ExercisePdfDay = {
  heading: string
  stats: ExercisePdfStat[]
  items: { time: string; text: string }[]
}

export type ExercisePdfDoc = {
  title: string
  brand: string
  site: string
  subtitle: string
  patientName: string
  dateOfBirth: string
  stats: ExercisePdfStat[]
  emptyMessage?: string
  days: ExercisePdfDay[]
}

export function canBuildExerciseLogPdf(
  report: FourWeekExerciseReport | null | undefined,
  gate: ExerciseGateState | null | undefined,
): report is FourWeekExerciseReport {
  return report != null && canExportExerciseLogPdf(gate)
}

export function exerciseLogPdfFilename(periodEnd: string): string {
  return `pfilates-exercise-log-${localDayKey(periodEnd)}.pdf`
}

export function exerciseLogReportSubtitle(report: FourWeekExerciseReport): string {
  return `Last ${report.spanDays} days · ${formatDay(report.periodStart)} – ${formatDay(report.periodEnd)}. Duration and frequency of sessions you logged.`
}

function formatDob(value: string): string {
  return value.includes('-') && value.length === 10 ? formatDateOfBirth(value) : value
}

export function exerciseLogPdfDoc(report: FourWeekExerciseReport): ExercisePdfDoc {
  return {
    title: EXERCISE_REPORT_TITLE,
    brand: PFILATES_BRAND,
    site: PFILATES_SITE,
    subtitle: exerciseLogReportSubtitle(report),
    patientName: report.patientName,
    dateOfBirth: formatDob(report.dateOfBirth),
    stats: [
      { label: 'Duration', value: exerciseDurationLabel(report) },
      { label: 'Frequency', value: exerciseFrequencyLabel(report) },
    ],
    emptyMessage: report.entries.length === 0 ? EXERCISE_REPORT_EMPTY : undefined,
    days: report.days.map((day) => ({
      heading: formatDay(day.items[0]?.at ?? day.day),
      stats: [
        { label: 'Duration', value: `${day.minutes} min` },
        { label: 'Frequency', value: `${day.sessions} ${day.sessions === 1 ? 'session' : 'sessions'}` },
      ],
      items: day.items.map((entry) => ({
        time: formatTime(entry.at),
        text: summarizeLog(entry),
      })),
    })),
  }
}

export function exerciseLogPdfPlainText(doc: ExercisePdfDoc): string {
  const lines = [
    doc.brand,
    doc.site,
    doc.title,
    doc.subtitle,
    `Name: ${doc.patientName}`,
    `Date of birth: ${doc.dateOfBirth}`,
    '',
  ]
  for (const stat of doc.stats) lines.push(`${stat.label}: ${stat.value}`)
  lines.push('')
  for (const day of doc.days) {
    lines.push(day.heading)
    for (const stat of day.stats) lines.push(`${stat.label}: ${stat.value}`)
    for (const item of day.items) lines.push(`${item.time}  ${item.text}`)
    lines.push('')
  }
  if (doc.emptyMessage) lines.push(doc.emptyMessage)
  return lines.join('\n')
}

export async function buildExerciseLogPdf(
  report: FourWeekExerciseReport,
  options?: { logoDataUrl?: string | null },
): Promise<{ filename: string; blob: Blob; bytes: Uint8Array }> {
  const { jsPDF } = await import('jspdf')
  const model = exerciseLogPdfDoc(report)
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 54
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const maxWidth = pageWidth - margin * 2
  let y = margin

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      pdf.addPage()
      y = margin
    }
  }

  const writeWrapped = (text: string, size: number, style: 'normal' | 'bold', gap: number) => {
    pdf.setFont('helvetica', style)
    pdf.setFontSize(size)
    const lines = pdf.splitTextToSize(pdfSafe(text), maxWidth) as string[]
    const lineHeight = size + 4
    for (const line of lines) {
      ensureSpace(lineHeight)
      pdf.text(line, margin, y)
      y += lineHeight
    }
    y += gap
  }

  pdf.setProperties({
    title: model.title,
    subject: model.subtitle,
    creator: 'Sara PfilAtes Coach',
  })

  const logo = options && 'logoDataUrl' in options ? options.logoDataUrl ?? null : await pfilatesLogoDataUrl()
  let drewLogo = false
  if (logo) {
    try {
      const embed = await downscaleLogoForPdf(logo)
      const logoWidth = 168
      const logoHeight = logoWidth * (281 / 1000)
      ensureSpace(logoHeight + 8)
      pdf.addImage(embed, 'PNG', margin, y, logoWidth, logoHeight)
      y += logoHeight + 10
      drewLogo = true
    } catch {
      drewLogo = false
    }
  }
  if (!drewLogo) {
    pdf.setTextColor(94, 107, 84)
    writeWrapped(model.brand, 22, 'bold', 2)
  }

  pdf.setTextColor(94, 107, 84)
  writeWrapped(model.site, 11, 'normal', 12)
  pdf.setTextColor(45, 42, 38)
  writeWrapped(model.title, 20, 'bold', 4)
  writeWrapped(model.subtitle, 11, 'normal', 8)
  writeWrapped(`Name: ${model.patientName}`, 12, 'bold', 1)
  writeWrapped(`Date of birth: ${model.dateOfBirth}`, 12, 'normal', 12)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  const colWidth = maxWidth / model.stats.length
  ensureSpace(36)
  model.stats.forEach((stat, index) => {
    const x = margin + colWidth * index
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(110, 106, 100)
    pdf.text(pdfSafe(stat.label), x, y)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(14)
    pdf.setTextColor(45, 42, 38)
    const valueLines = pdf.splitTextToSize(pdfSafe(stat.value), colWidth - 8) as string[]
    pdf.text(valueLines, x, y + 18)
  })
  y += 44

  if (model.emptyMessage) {
    writeWrapped(model.emptyMessage, 11, 'normal', 8)
  }

  for (const day of model.days) {
    ensureSpace(56)
    writeWrapped(day.heading, 14, 'bold', 4)
    for (const stat of day.stats) {
      writeWrapped(`${stat.label}: ${stat.value}`, 11, 'normal', 2)
    }
    for (const item of day.items) {
      ensureSpace(18)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(11)
      pdf.setTextColor(45, 42, 38)
      pdf.text(pdfSafe(item.time), margin, y)
      const textLines = pdf.splitTextToSize(pdfSafe(item.text), maxWidth - 72) as string[]
      pdf.text(textLines, margin + 72, y)
      y += Math.max(16, textLines.length * 14)
    }
    y += 12
  }

  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(110, 106, 100)
    pdf.text(model.site, margin, pageHeight - 28)
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 28, {
      align: 'right',
    })
  }

  const filename = exerciseLogPdfFilename(report.periodEnd)
  const bytes = new Uint8Array(pdf.output('arraybuffer'))
  const blob = new Blob([bytes], { type: 'application/pdf' })
  return { filename, blob, bytes }
}

export async function exportExerciseLogPdf(report: FourWeekExerciseReport): Promise<void> {
  const { filename, blob } = await buildExerciseLogPdf(report)
  await deliverPdfBlob(blob, filename)
}
