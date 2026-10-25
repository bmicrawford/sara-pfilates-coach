/**
 * Leading greetings Sara should not repeat after the opening turn.
 * Shared by the Ask Sara reply and the sentence chunks sent to TTS.
 */

const GREETING_AT_START = /^(?:hey|hi|hello)(?:\s+there)?(?=$|[\s,!.;:?…\-–—])/i
const GREETING_PUNCT = /^(?:\s*[,!.;:?…]+|\s*[-–—]+)\s*/

function capitalizeNextWord(text) {
  return text.replace(/^([^A-Za-z]*)([a-z])/, (all, lead, ch) => lead + ch.toUpperCase())
}

/**
 * Drop one or more leading greeting phrases and capitalize the next word.
 * A greeting-only line is left as-is so a real reply is not wiped.
 * @param {string} text
 * @returns {string}
 */
export function stripLeadingGreeting(text) {
  const original = String(text ?? '').trim()
  let rest = original
  for (let n = 0; n < 3; n += 1) {
    const found = GREETING_AT_START.exec(rest)
    if (!found) break
    let next = rest.slice(found[0].length)
    const punct = GREETING_PUNCT.exec(next)
    if (punct && punct[0]) {
      next = next.slice(punct[0].length)
    } else {
      const space = /^\s+/.exec(next)
      if (!space) break
      next = next.slice(space[0].length)
    }
    next = next.trimStart()
    if (!next) return original
    rest = capitalizeNextWord(next)
  }
  return rest
}
