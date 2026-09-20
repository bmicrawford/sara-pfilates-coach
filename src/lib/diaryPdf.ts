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

export type BladderDiaryPdfBytes = { filename: string; blob: Blob; bytes: Uint8Array }

export type BuildBladderDiaryPdfOptions = {
  logoDataUrl?: string | null
  /** Force the no-jsPDF path (Surge chunk 404 / MIME / constructor failure). */
  engine?: 'auto' | 'jspdf' | 'plain'
}

type ShareNav = Navigator & {
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
}

type JsPdfCtor = new (options: { unit: string; format: string }) => {
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
  setFont: (face: string, style: string) => void
  setFontSize: (size: number) => void
  setTextColor: (r: number, g: number, b: number) => void
  setProperties: (props: { title: string; subject: string; creator: string }) => void
  splitTextToSize: (text: string, width: number) => string[]
  text: (text: string | string[], x: number, y: number, options?: { align?: string }) => void
  addImage: (image: string, format: string, x: number, y: number, w: number, h: number) => void
  addPage: () => void
  getNumberOfPages: () => number
  setPage: (page: number) => void
  output: (type: 'arraybuffer') => ArrayBuffer
}

function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
}

function pdfEscape(text: string): string {
  return pdfSafe(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function preferShareSheet(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
  return Boolean(coarse || isStandalonePwa())
}

/** iOS Safari / installed PWA treat `a.download` on blob URLs as a no-op. */
function downloadAttributeIsNoop(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return iOS || isStandalonePwa()
}

function isShareAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  )
}

function openPdfUrl(url: string) {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.assign(url)
}

function openPdfInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    window.location.assign(url)
    return
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function triggerAnchorDownload(blob: Blob, filename: string) {
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

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'function') {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('logo read failed'))
      }
      reader.onerror = () => reject(reader.error ?? new Error('logo read failed'))
      reader.readAsDataURL(blob)
    })
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

async function pfilatesLogoDataUrl(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return null
    const res = await fetch(PFILATES_LOGO_SRC)
    if (!res.ok) return null
    return await readBlobAsDataUrl(await res.blob())
  } catch {
    return null
  }
}

function loadLogoImage(
  src: string,
): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = window.setTimeout(() => reject(new Error('logo decode timeout')), 2500)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve({
        width: image.width,
        height: image.height,
        draw: (ctx, w, h) => {
          ctx.drawImage(image, 0, 0, w, h)
        },
      })
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('logo decode failed'))
    }
    image.src = src
  })
}

/** Shrink the logo to a small JPEG. Returns null on canvas/decode failure so we never retry the original PNG. */
async function downscaleLogoForPdf(dataUrl: string, maxWidthPx = 280): Promise<string | null> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl
    const image = await loadLogoImage(dataUrl)
    if (!image.width || !image.height) return null
    const scale = Math.min(1, maxWidthPx / image.width)
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#F6F3EE'
    ctx.fillRect(0, 0, width, height)
    image.draw(ctx, width, height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

function logoImageFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return /image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG'
}

export async function loadJsPdf(): Promise<JsPdfCtor | null> {
  try {
    const mod = (await import('jspdf')) as { jsPDF?: JsPdfCtor; default?: JsPdfCtor | { jsPDF?: JsPdfCtor } }
    const ctor = mod.jsPDF ?? (typeof mod.default === 'function' ? mod.default : mod.default?.jsPDF)
    return typeof ctor === 'function' ? ctor : null
  } catch {
    return null
  }
}

function wrapPlainText(text: string, maxChars: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Text-only PDF that does not load the jsPDF chunk — used when import/MIME/addImage would abort export. */
export function buildPlainBladderDiaryPdf(model: BladderDiaryPdfDoc, filename: string): BladderDiaryPdfBytes {
  const pageW = 612
  const pageH = 792
  const margin = 54
  const maxChars = 86
  type Line = { text: string; size: number }
  const lines: Line[] = []
  const add = (text: string, size: number) => {
    for (const part of wrapPlainText(text, maxChars)) lines.push({ text: part, size })
    lines.push({ text: '', size: 6 })
  }

  add(model.brand, 18)
  add(model.site, 11)
  add(model.title, 16)
  add(model.status, 11)
  add(model.subtitle, 11)
  add(`Name: ${model.patientName}`, 12)
  add(`Date of birth: ${model.dateOfBirth}`, 12)
  if (model.emptyMessage) add(model.emptyMessage, 11)
  for (const day of model.days) {
    add(day.incomplete ? `${day.heading} (${day.incomplete})` : day.heading, 13)
    for (const stat of day.stats) add(`${stat.label}: ${stat.value}`, 11)
    for (const item of day.items) add(`${item.time}  ${item.text}`, 11)
  }

  const pages: Line[][] = []
  let page: Line[] = []
  let y = pageH - margin
  for (const line of lines) {
    const height = line.size + 4
    if (y - height < margin + 18) {
      pages.push(page)
      page = []
      y = pageH - margin
    }
    page.push(line)
    y -= height
  }
  if (page.length > 0) pages.push(page)
  if (pages.length === 0) pages.push([{ text: model.title, size: 16 }])

  let nextId = 1
  const catalogId = nextId++
  const pagesId = nextId++
  const fontId = nextId++
  const pageIds = pages.map(() => nextId++)
  const contentIds = pages.map(() => nextId++)

  const objects: { id: number; body: string }[] = [
    { id: catalogId, body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` },
    {
      id: pagesId,
      body: `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
    },
    { id: fontId, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]

  pages.forEach((pageLines, index) => {
    let cursor = pageH - margin
    const ops: string[] = []
    for (const line of pageLines) {
      if (line.text) {
        ops.push(`BT /F1 ${line.size} Tf ${margin} ${cursor} Td (${pdfEscape(line.text)}) Tj ET`)
      }
      cursor -= line.size + 4
    }
    ops.push(`BT /F1 9 Tf ${margin} 28 Td (${pdfEscape(model.site)}) Tj ET`)
    ops.push(
      `BT /F1 9 Tf ${pageW - margin} 28 Td (${pdfEscape(`Page ${index + 1} of ${pages.length}`)}) Tj ET`,
    )
    const stream = ops.join('\n')
    objects.push({
      id: pageIds[index]!,
      body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    })
    objects.push({
      id: contentIds[index]!,
      body: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    })
  })

  objects.sort((a, b) => a.id - b.id)
  let out = '%PDF-1.3\n'
  const offsets = [0]
  for (const object of objects) {
    offsets[object.id] = out.length
    out += `${object.id} 0 obj\n${object.body}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= objects.length; id += 1) {
    out += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer << /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  const bytes = new TextEncoder().encode(out)
  return { filename, blob: new Blob([bytes], { type: 'application/pdf' }), bytes }
}

async function buildWithJsPdf(
  model: BladderDiaryPdfDoc,
  filename: string,
  options?: BuildBladderDiaryPdfOptions,
): Promise<BladderDiaryPdfBytes> {
  const JsPDF = await loadJsPdf()
  if (!JsPDF) throw new Error('jspdf unavailable')
  const pdf = new JsPDF({ unit: 'pt', format: 'letter' })
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
    const wrapped = pdf.splitTextToSize(pdfSafe(text), maxWidth)
    const lineHeight = size + 4
    for (const line of wrapped) {
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
      if (embed) {
        const logoWidth = 168
        const logoHeight = logoWidth * (281 / 1000)
        ensureSpace(logoHeight + 8)
        pdf.addImage(embed, logoImageFormat(embed), margin, y, logoWidth, logoHeight)
        y += logoHeight + 10
        drewLogo = true
      }
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
        const textLines = pdf.splitTextToSize(pdfSafe(item.text), maxWidth - 72)
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

  const bytes = new Uint8Array(pdf.output('arraybuffer'))
  return { filename, blob: new Blob([bytes], { type: 'application/pdf' }), bytes }
}

export async function buildBladderDiaryPdf(
  report: BladderDiaryReport,
  options?: BuildBladderDiaryPdfOptions,
): Promise<BladderDiaryPdfBytes> {
  const model = bladderDiaryPdfDoc(report)
  const filename = bladderDiaryPdfFilename(report.firstEventAt ?? report.startedAt)
  if (options?.engine === 'plain') return buildPlainBladderDiaryPdf(model, filename)
  try {
    return await buildWithJsPdf(model, filename, options)
  } catch {
    return buildPlainBladderDiaryPdf(model, filename)
  }
}

export function pdfFileFromBlob(blob: Blob, filename: string): File | null {
  try {
    return new File([blob], filename, { type: 'application/pdf' })
  } catch {
    return null
  }
}

/** `canShare({ files })` throws on some iOS / PWA builds — never let that abort export. */
export function canSharePdfFile(nav: ShareNav, file: File): boolean {
  try {
    return typeof nav.canShare === 'function' && nav.canShare({ files: [file] }) === true
  } catch {
    return false
  }
}

export async function deliverBladderDiaryPdf(blob: Blob, filename: string): Promise<void> {
  const nav = navigator as ShareNav
  const file = pdfFileFromBlob(blob, filename)

  if (file && preferShareSheet() && canSharePdfFile(nav, file)) {
    try {
      await nav.share?.({ files: [file], title: filename })
      return
    } catch (error) {
      if (isShareAbort(error)) return
    }
  }

  if (preferShareSheet() && typeof nav.share === 'function') {
    try {
      const url = URL.createObjectURL(blob)
      const data: ShareData = { title: filename, text: `${modelShareText()}`, url }
      const allowed = (() => {
        try {
          return typeof nav.canShare !== 'function' || nav.canShare(data) === true
        } catch {
          return true
        }
      })()
      if (allowed) {
        try {
          await nav.share(data)
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
          return
        } catch (error) {
          URL.revokeObjectURL(url)
          if (isShareAbort(error)) return
        }
      } else {
        URL.revokeObjectURL(url)
      }
    } catch {
      // continue to download / open fallbacks
    }
  }

  if (!downloadAttributeIsNoop()) {
    try {
      triggerAnchorDownload(blob, filename)
      return
    } catch {
      // iOS standalone often no-ops a.download — keep going
    }
  }

  try {
    openPdfInNewTab(blob)
    return
  } catch {
    const dataUrl = await readBlobAsDataUrl(blob)
    openPdfUrl(dataUrl)
  }
}

function modelShareText(): string {
  return 'Bladder diary report PDF. You can save it before the diary is finished.'
}

export async function exportBladderDiaryPdf(report: BladderDiaryReport): Promise<void> {
  const { filename, blob } = await buildBladderDiaryPdf(report)
  await deliverBladderDiaryPdf(blob, filename)
}
