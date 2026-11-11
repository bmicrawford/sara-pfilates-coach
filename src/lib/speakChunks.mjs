/**
 * Split a reply into at most SARA_SPEAK_MAX_CHUNKS pieces for /speak.
 * The first chunk is the first sentence so TTS can start while the rest
 * is fetched. Extra sentences pack into the last chunks.
 */

import { stripLeadingGreeting } from './saraGreeting.mjs'

export const SARA_SPEAK_MAX_CHUNKS = 3

const ABBR = /(?:Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|etc)\.$/i

export function splitSentences(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const parts = []
  let buf = ''
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    buf += ch
    if (ch !== '.' && ch !== '!' && ch !== '?') continue
    if (ch === '.' && clean[i + 1] === '.') continue
    const atEnd = i === clean.length - 1
    const boundary = atEnd || /\s/.test(clean[i + 1] || '')
    if (!boundary) continue
    const trimmed = buf.trim()
    if (ch === '.' && ABBR.test(trimmed)) continue
    if (ch === '.' && /\d\.$/.test(trimmed) && /\d/.test(clean[i + 1] || '')) continue
    if (trimmed) parts.push(trimmed)
    buf = ''
    while (clean[i + 1] === ' ') i += 1
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts
}

export function splitSpeakChunks(text, maxChunks = SARA_SPEAK_MAX_CHUNKS) {
  const sentences = splitSentences(text)
  const cap = Math.max(1, Math.floor(Number(maxChunks) || SARA_SPEAK_MAX_CHUNKS))
  if (sentences.length <= cap) return sentences
  const head = sentences.slice(0, cap - 1)
  const tail = sentences.slice(cap - 1).join(' ')
  return [...head, tail]
}

/**
 * Follow-up turns drop a leading greeting before the split, so the first
 * chunk TTS speaks is the answer and not "Hey there."
 * @param {string} text
 * @param {boolean} [firstTurn]
 * @param {number} [maxChunks]
 */
export function splitSpeakChunksForTurn(text, firstTurn = true, maxChunks = SARA_SPEAK_MAX_CHUNKS) {
  const spoken = firstTurn === false ? stripLeadingGreeting(text) : text
  return splitSpeakChunks(spoken, maxChunks)
}
