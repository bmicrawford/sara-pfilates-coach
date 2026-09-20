import {
  BLADDER_TOTAL_FIELDS,
  INCOMPLETE_DAY_LABEL,
  PFILATES_BRAND,
  PFILATES_SITE,
  diaryDayNumber,
  type BladderDiaryReport,
} from './diary.ts'
import { localDayKey, summarizeLog } from './diary.ts'
import { formatDateOfBirth } from './patient.ts'
import { formatDateTime, formatDay, formatTime } from './storage.ts'

export const DOWNLOAD_PDF_LABEL = 'Download PDF'
export const DOWNLOAD_PDF_ANYTIME_HINT =
  'You can download this PDF before the diary is finished. Incomplete days are included as they are.'
export const DIARY_REPORT_TITLE = 'Bladder diary report'
export const DIARY_REPORT_EMPTY =
  'Nothing recorded yet. Keep logging from Home — this report stays available while the diary is in progress.'
export const PFILATES_LOGO_SRC = '/brand/pfilates-logo.png'

/** Any started diary can be exported — in progress or finished, 0–3 days complete. Never gated on finish / 72h / all days done. */
export function canExportBladderDiaryPdf(
  report: BladderDiaryReport | null | undefined,
): report is BladderDiaryReport {
  return report != null
}

export function bladderDiaryPdfFilename(startedAt: string): string {
  return `pfilates-bladder-diary-${localDayKey(startedAt)}.pdf`
}

export function bladderDiaryStatusLabel(status: BladderDiaryReport['status']): string {
  return status === 'in_progress' ? 'In progress' : 'Finished'
}

export function bladderDiaryReportSubtitle(report: BladderDiaryReport): string {
  if (!report.firstEventAt) {
    return `Started ${formatDay(report.startedAt)}. Clock starts at the first logged event. This report is readable while the diary is still open.`
  }
  if (report.status === 'in_progress') {
    return `First event ${formatDateTime(report.firstEventAt)}. Three 24-hour days from that time. This report is readable while the diary is still open.`
  }
  return `First event ${formatDateTime(report.firstEventAt)}${
    report.completedAt ? ` · finished ${formatDay(report.completedAt)}` : ''
  }.`
}

export function incompleteDayLabel(day: BladderDiaryReport['days'][number]): string | undefined {
  if (!day.incomplete) return undefined
  if (day.empty && day.day === 1) return `${INCOMPLETE_DAY_LABEL} — no events yet`
  return INCOMPLETE_DAY_LABEL
}

export type BladderDiaryPdfStat = { label: string; value: number }

export type BladderDiaryPdfDay = {
  heading: string
  incomplete?: string
  stats: BladderDiaryPdfStat[]
  items: { time: string; text: string }[]
}

export type BladderDiaryPdfDoc = {
  title: string
  brand: string
  site: string
  status: string
  subtitle: string
  patientName: string
  dateOfBirth: string
  stats: BladderDiaryPdfStat[]
  emptyMessage?: string
  days: BladderDiaryPdfDay[]
}

function dayStats(day: BladderDiaryReport['days'][number]): BladderDiaryPdfStat[] {
  return BLADDER_TOTAL_FIELDS.map((field) => ({ label: field.label, value: day[field.key] }))
}

/** Same 3-day totals as the on-screen report — no extra clinical copy. */
export function bladderDiaryPdfDoc(report: BladderDiaryReport): BladderDiaryPdfDoc {
  return {
    title: DIARY_REPORT_TITLE,
    brand: PFILATES_BRAND,
    site: PFILATES_SITE,
    status: bladderDiaryStatusLabel(report.status),
    subtitle: bladderDiaryReportSubtitle(report),
    patientName: report.patientName,
    dateOfBirth:
      report.dateOfBirth.includes('-') && report.dateOfBirth.length === 10
        ? formatDateOfBirth(report.dateOfBirth)
        : report.dateOfBirth,
    stats: BLADDER_TOTAL_FIELDS.map((field) => ({ label: field.label, value: report[field.key] })),
    emptyMessage: report.entries.length === 0 && !report.firstEventAt ? DIARY_REPORT_EMPTY : undefined,
    days: report.days.map((day) => ({
      heading: day.label,
      incomplete: incompleteDayLabel(day),
      stats: dayStats(day),
      items: report.entries
        .filter((entry) => report.firstEventAt !== null && diaryDayNumber(entry.at, report.firstEventAt) === day.day)
        .map((entry) => ({
          time: formatTime(entry.at),
          text: summarizeLog(entry),
        })),
    })),
  }
}

export function bladderDiaryPdfPlainText(doc: BladderDiaryPdfDoc): string {
  const lines = [doc.brand, doc.site, doc.title, doc.status, doc.subtitle, `Name: ${doc.patientName}`, `Date of birth: ${doc.dateOfBirth}`, '']
  for (const day of doc.days) {
    lines.push(day.incomplete ? `${day.heading} (${day.incomplete})` : day.heading)
    for (const stat of day.stats) lines.push(`${stat.label}: ${stat.value}`)
    for (const item of day.items) lines.push(`${item.time}  ${item.text}`)
    lines.push('')
  }
  if (doc.emptyMessage) lines.push(doc.emptyMessage)
  return lines.join('\n')
}

function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
}

function preferShareSheet(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(coarse || standalone)
}

function isShareAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
}

async function pfilatesLogoDataUrl(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return null
    const res = await fetch(PFILATES_LOGO_SRC)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return `data:image/png;base64,${btoa(binary)}`
  } catch {
    return null
  }
}

export async function buildBladderDiaryPdf(
  report: BladderDiaryReport,
  options?: { logoDataUrl?: string | null },
): Promise<{ filename: string; blob: Blob; bytes: Uint8Array }> {
  const { jsPDF } = await import('jspdf')
  const model = bladderDiaryPdfDoc(report)
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
  if (logo) {
    const logoWidth = 168
    const logoHeight = logoWidth * (281 / 1000)
    ensureSpace(logoHeight + 8)
    pdf.addImage(logo, 'PNG', margin, y, logoWidth, logoHeight)
    y += logoHeight + 10
  } else {
    pdf.setTextColor(94, 107, 84)
    writeWrapped(model.brand, 22, 'bold', 2)
  }

  pdf.setTextColor(94, 107, 84)
  writeWrapped(model.site, 11, 'normal', 12)
  pdf.setTextColor(45, 42, 38)
  writeWrapped(model.title, 20, 'bold', 4)
  writeWrapped(model.status, 11, 'bold', 2)
  writeWrapped(model.subtitle, 11, 'normal', 8)
  writeWrapped(`Name: ${model.patientName}`, 12, 'bold', 1)
  writeWrapped(`Date of birth: ${model.dateOfBirth}`, 12, 'normal', 12)

  if (model.emptyMessage && model.days.every((day) => day.stats.every((stat) => stat.value === 0))) {
    writeWrapped(model.emptyMessage, 11, 'normal', 8)
  }

  for (const day of model.days) {
    ensureSpace(86)
    const heading = day.incomplete ? `${day.heading}  (${day.incomplete})` : day.heading
    writeWrapped(heading, 14, 'bold', 6)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    const colWidth = maxWidth / 5
    ensureSpace(36)
    day.stats.forEach((stat, index) => {
      const x = margin + colWidth * index
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(110, 106, 100)
      pdf.text(pdfSafe(stat.label), x, y)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(16)
      pdf.setTextColor(45, 42, 38)
      pdf.text(String(stat.value), x, y + 18)
    })
    y += 36
    if (day.items.length > 0) {
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

  const filename = bladderDiaryPdfFilename(report.firstEventAt ?? report.startedAt)
  const bytes = new Uint8Array(pdf.output('arraybuffer'))
  const blob = new Blob([bytes], { type: 'application/pdf' })
  return { filename, blob, bytes }
}

export async function exportBladderDiaryPdf(report: BladderDiaryReport): Promise<void> {
  const { filename, blob } = await buildBladderDiaryPdf(report)
  const file = new File([blob], filename, { type: 'application/pdf' })
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }

  if (preferShareSheet() && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share?.({ files: [file], title: filename })
      return
    } catch (error) {
      if (isShareAbort(error)) return
    }
  }

  triggerDownload(blob, filename)
}
