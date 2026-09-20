/**
 * Speak-only brand pronunciation.
 *
 * On-screen / chat copy stays `PfilAtes`. Before D-ID JennyNeural `speak()`
 * and xAI ara `POST /speak`, rewrite mentions to a plain-text form both
 * engines already know how to say.
 *
 * Why `fill-ah-tees` (not `Filates`, not `fil la tees`):
 * - D-ID Agents `speak({ type: 'text' })` is plain text (no SSML phoneme).
 * - ara can take IPA via `replace`, but Jenny cannot share that path, so one
 *   helper must stay a respelling both voices will read.
 * - `PfilAtes` is unknown; leading Pf- is how we get “P-filates” / “pee-filates”.
 * - `Filates` is also unknown. English *-ates G2P is usually /eɪts/ (two
 *   syllables). Lexical `Pilates` (/pɪˈlɑːtiːz/) does not transfer.
 * - `fil la tees` is three words and sounds listed, not named.
 * - `fill-ah-tees` is fill + ah + tees — three dictionary syllables, one
 *   compound, heard as fil-la-tees.
 */
export const PFILATES_SPOKEN = 'fill-ah-tees'

const BRAND = /\bpfilates\b/gi

/** @param {string} [text] */
export function rewritePfilatesForSpeech(text) {
  return String(text ?? '').replace(BRAND, PFILATES_SPOKEN)
}
