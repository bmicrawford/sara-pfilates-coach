import { SARA_SPEAK_MAX_CHUNKS, splitSentences, splitSpeakChunks } from './speakChunks.mjs'
import { readFileSync } from 'node:fs'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(SARA_SPEAK_MAX_CHUNKS === 3, 'speak chunks cap at 3 so demo /speak stays inside the raised limit')

const three = splitSpeakChunks('Sip water through the day. A glass with meals is plenty. Log what you notice.')
assert(three.length === 3, 'three sentences stay three chunks')
assert(three[0] === 'Sip water through the day.', 'first chunk is sentence 1 only')
assert(three[2] === 'Log what you notice.', 'last sentence is its own chunk when it fits')

const five = splitSentences('One. Two. Three. Four. Five.')
assert(five.length === 5, 'splits on sentence boundaries')
const packed = splitSpeakChunks('One. Two. Three. Four. Five.')
assert(packed.length === 3, 'five sentences pack into 3 chunks')
assert(packed[0] === 'One.', 'packing keeps sentence 1 alone so TTS can start')
assert(packed[1] === 'Two.', 'sentence 2 stays its own chunk')
assert(packed[2] === 'Three. Four. Five.', 'the tail joins into the last chunk')

const doctor = splitSpeakChunks('Dr. Crawford made this. It takes 10 minutes.')
assert(doctor.length === 2, 'Dr. is not a sentence boundary')
assert(doctor[0] === 'Dr. Crawford made this.', 'abbreviation stays on the first sentence')

const decimal = splitSpeakChunks('It rose 1.5 points today. Then we rested.')
assert(decimal.length === 2 && decimal[0].includes('1.5'), 'decimals are not sentence breaks')

assert(splitSpeakChunks('').length === 0, 'empty reply does not call /speak')
assert(splitSpeakChunks('No punctuation here').length === 1, 'a fragment is one chunk')

const speakSrc = readFileSync(new URL('./speakSara.ts', import.meta.url), 'utf8')
assert(/splitSpeakChunks/.test(speakSrc), 'speakSara fetches one chunk at a time from the splitter')
assert(/chunks\.map/.test(speakSrc), 'later sentences are requested in parallel')
assert(/source\.start\(when\)/.test(speakSrc), 'chunks are scheduled on the audio clock')
assert(/createAnalyser/.test(speakSrc), 'glow level comes from an AnalyserNode')
assert(/void current\.ctx\.resume\(\)/.test(speakSrc), 'AudioContext resumes inside the tap')
assert(/gain\.gain\.value = 0/.test(speakSrc), 'unlock starts a silent buffer during the gesture')
assert(!/audio\.pause\(/.test(speakSrc), 'unlock does not pause an element after the gesture')
assert(!/audio\.load\(/.test(speakSrc), 'stop does not load() an audio element')
assert(!/speechSynthesis/.test(speakSrc), 'speakSara.ts has no speechSynthesis fallback')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/Sara is listening/.test(askSrc), 'Ask Sara shows the listening line as soon as Send runs')
assert(/unlockSaraSpeech\(\)/.test(askSrc), 'Send unlocks audio inside the tap')

const portrait = readFileSync(new URL('../components/TalkingPortrait.tsx', import.meta.url), 'utf8')
assert(/data-sara-phase/.test(portrait), 'portrait exposes listening and speaking phases')
assert(/subscribeSaraLevel/.test(portrait), 'speaking glow follows the analyser level')
assert(/sara-glow/.test(portrait), 'portrait has a glow ring')

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
assert(/sara-breathe/.test(css), 'idle portrait breathes')
assert(/sara-speak/.test(css), 'speaking portrait sways')
assert(/prefers-reduced-motion/.test(css), 'motion respects prefers-reduced-motion')
assert(/--sara-level/.test(css), 'glow ring uses the audio level')

if (process.exitCode) {
  console.error('speak chunk smoke failed')
  process.exit(1)
}
console.log('speak chunk smoke passed')
