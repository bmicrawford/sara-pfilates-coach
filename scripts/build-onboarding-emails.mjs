/**
 * Rebuild server/onboardingEmails.mjs from content/onboarding-emails/*.txt
 * and the curated notes in scripts/onboarding-email-notes.mjs.
 *
 *   node scripts/build-onboarding-emails.mjs
 *   node scripts/build-onboarding-emails.mjs /path/to/email-folder
 *
 * A new .txt file, or a subject or day that no longer matches the note,
 * fails the build so the note is updated on purpose. Notes must not carry
 * study statistics or pregnancy wording from the emails.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ONBOARDING_NOTES } from './onboarding-email-notes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'server/onboardingEmails.mjs')
const folder = process.argv[2] ? process.argv[2] : join(root, 'content/onboarding-emails')

const BANNED = [
  [/\b10x\b/i, '10x'],
  [/\bten times\b/i, 'ten times'],
  [/\b10\s+times\b/i, '10 times'],
  [/74%/, '74%'],
  [/29%/, '29%'],
  [/8 times/i, '8 times'],
  [/62%/, '62%'],
  [/95\.2/, '95.2'],
  [/60\.7/, '60.7'],
  [/43\.6/, '43.6'],
  [/52\.8/, '52.8'],
  [/3 in 10/i, '3 in 10'],
  [/lying on your back/i, 'lying on your back'],
  [/80%\s+reported/i, 'email wording of the 28-day result'],
  [/\bcure\b/i, 'cure'],
  [/\bproven\b/i, 'proven'],
]

function parseEmail(text, file) {
  const subject = text.match(/^Subject:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const delay = text.match(/^Delay\/trigger:\s*(.+)$/m)?.[1]?.trim() ?? ''
  if (!subject) throw new Error(`${file}: missing Subject`)
  if (!delay) throw new Error(`${file}: missing Delay/trigger`)
  const dayMatch = delay.match(/Day\s*(\d+)/i)
  return { subject, day: dayMatch ? Number(dayMatch[1]) : null }
}

function cardText(note) {
  return [note.summary, note.asks, note.guidance, note.newer].filter(Boolean).join('\n')
}

function checkBanned(file, note) {
  const text = cardText(note)
  for (const [pattern, label] of BANNED) {
    if (pattern.test(text)) throw new Error(`${file}: note contains banned material (${label})`)
  }
}

const files = readdirSync(folder)
  .filter((name) => name.endsWith('.txt'))
  .sort((a, b) => a.localeCompare(b, 'en'))

if (files.length !== 47) throw new Error(`expected 47 email files, found ${files.length} in ${folder}`)

const noted = new Set(Object.keys(ONBOARDING_NOTES))
for (const file of files) {
  if (!noted.has(file)) throw new Error(`${file}: add a note in scripts/onboarding-email-notes.mjs`)
}
for (const file of noted) {
  if (!files.includes(file)) throw new Error(`${file}: note has no email file`)
}

const records = files.map((file, index) => {
  const parsed = parseEmail(readFileSync(join(folder, file), 'utf8'), file)
  const note = ONBOARDING_NOTES[file]
  if (parsed.subject !== note.subject) {
    throw new Error(`${file}: subject changed.\n  file: ${parsed.subject}\n  note: ${note.subject}`)
  }
  if (parsed.day != null && parsed.day !== note.day) {
    throw new Error(`${file}: day is ${parsed.day} in the file and ${note.day} in the note`)
  }
  if (parsed.day == null && !Number.isInteger(note.day)) throw new Error(`${file}: note needs a day`)
  checkBanned(file, note)
  const who = note.who
  if (!['women', 'men', 'both'].includes(who)) throw new Error(`${file}: who must be women, men, or both`)
  return {
    file,
    order: index + 1,
    sequence: note.sequence,
    who,
    track: note.track,
    day: note.day,
    dayLabel: note.dayLabel,
    trigger: note.trigger,
    subject: note.subject,
    summary: note.summary,
    asks: note.asks,
    guidance: note.guidance,
    newer: note.newer || '',
    keys: note.keys,
  }
})

const body = records.map((record) => `  ${JSON.stringify(record)},`).join('\n')
const src = readFileSync(outFile, 'utf8')
const start = src.indexOf('// <generated>')
const end = src.indexOf('// </generated>')
if (start < 0 || end < start) throw new Error('server/onboardingEmails.mjs is missing generation markers')
const next = `${src.slice(0, start)}// <generated>\n${body}\n  // </generated>${src.slice(end + '// </generated>'.length)}`
writeFileSync(outFile, next)
console.log(`wrote ${records.length} onboarding emails to server/onboardingEmails.mjs`)
