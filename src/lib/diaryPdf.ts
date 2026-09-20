import type { BladderDiaryReport } from './diary.ts'
import { groupLogsByDay, localDayKey, summarizeLog } from './diary.ts'
import { formatDay, formatTime } from './storage.ts'

export const DOWNLOAD_PDF_LABEL = 'Download PDF'
export const DIARY_REPORT_TITLE = 'Bladder diary report'
export const DIARY_REPORT_EMPTY =
  'Nothing recorded yet. Keep logging from Home — this report stays available while the diary is in progress.'

export function bladderDiaryPdfFilename(startedAt: string): string {
  return `pfilates-bladder-diary-${localDayKey(startedAt)}.pdf`
}

export function bladderDiaryStatusLabel(status: BladderDiaryReport['status']): string {
  return status === 'in_progress' ? 'In progress' : 'Finished'
}

export function bladderDiaryReportSubtitle(report: BladderDiaryReport): string {
  if (report.status === 'in_progress') {
    return `Started ${formatDay(report.startedAt)}. This report is readable while the diary is still open.`
  }
  return `Started ${formatDay(report.startedAt)}${
    report.completedAt ? ` · finished ${formatDay(report.completedAt)}` : ''
  }.`
}

export type BladderDiaryPdfStat = { label: string; value: number }

export type BladderDiaryPdfDay = {
  heading: string
  items: { time: string; text: string }[]
}

export type BladderDiaryPdfDoc = {
  title: string
  status: string
  subtitle: string
  stats: BladderDiaryPdfStat[]
  emptyMessage?: string
  days: BladderDiaryPdfDay[]
}

/** Same totals and event lines as the on-screen report — no extra clinical copy. */
export function bladderDiaryPdfDoc(report: BladderDiaryReport): BladderDiaryPdfDoc {
  return {
    title: DIARY_REPORT_TITLE,
    status: bladderDiaryStatusLabel(report.status),
    subtitle: bladderDiaryReportSubtitle(report),
    stats: [
      { label: 'Drinks', value: report.drinks },
      { label: 'Voids', value: report.voids },
      { label: 'Leaks', value: report.leaks },
      { label: 'Urges', value: report.urges },
      { label: 'Pad changes', value: report.pads },
    ],
    emptyMessage: report.entries.length === 0 ? DIARY_REPORT_EMPTY : undefined,
    days: groupLogsByDay(report.entries).map((group) => ({
      heading: formatDay(group.items[0]?.at ?? group.day),
      items: group.items.map((entry) => ({
        time: formatTime(entry.at),
        text: summarizeLog(entry),
      })),
    })),
  }
}

export function bladderDiaryPdfPlainText(doc: BladderDiaryPdfDoc): string {
  const lines = [doc.title, doc.status, doc.subtitle, '']
  for (const stat of doc.stats) lines.push(`${stat.label}: ${stat.value}`)
  lines.push('')
  if (doc.emptyMessage) {
    lines.push(doc.emptyMessage)
  } else {
    for (const day of doc.days) {
      lines.push(day.heading)
      for (const item of day.items) lines.push(`${item.time}  ${item.text}`)
      lines.push('')
    }
  }
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

export async function buildBladderDiaryPdf(
  report: BladderDiaryReport,
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

  pdf.setTextColor(45, 42, 38)
  writeWrapped(model.title, 20, 'bold', 4)
  writeWrapped(model.status, 11, 'bold', 2)
  writeWrapped(model.subtitle, 11, 'normal', 10)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  const colWidth = maxWidth / 5
  ensureSpace(36)
  model.stats.forEach((stat, index) => {
    const x = margin + colWidth * index
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(pdfSafe(stat.label), x, y)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.text(String(stat.value), x, y + 18)
  })
  y += 40

  if (model.emptyMessage) {
    writeWrapped(model.emptyMessage, 11, 'normal', 0)
  } else {
    for (const day of model.days) {
      writeWrapped(day.heading, 13, 'bold', 4)
      for (const item of day.items) {
        ensureSpace(18)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(11)
        pdf.text(pdfSafe(item.time), margin, y)
        const textLines = pdf.splitTextToSize(pdfSafe(item.text), maxWidth - 72) as string[]
        pdf.text(textLines, margin + 72, y)
        y += Math.max(16, textLines.length * 14)
      }
      y += 10
    }
  }

  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(110, 106, 100)
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 28, {
      align: 'right',
    })
  }

  const filename = bladderDiaryPdfFilename(report.startedAt)
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
