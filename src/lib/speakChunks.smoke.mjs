import { SARA_SPEAK_MAX_CHUNKS, splitSentences, splitSpeakChunks, splitSpeakChunksForTurn } from './speakChunks.mjs'
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

const followUpVoice = splitSpeakChunksForTurn(
  'Hey there. Sip water through the day. A glass with meals is plenty.',
  false,
)
assert(followUpVoice[0] === 'Sip water through the day.', 'a follow-up voice chunk does not start with Hey there')
assert(!/^(hey|hi|hello)\b/i.test(followUpVoice[0]), 'second-turn spoken answer does not start with a greeting')
assert(
  splitSpeakChunksForTurn('Hi there, sip water through the day.', false)[0] === 'Sip water through the day.',
  'Hi there is stripped before the first voice chunk',
)
assert(
  splitSpeakChunksForTurn("Hi, it's Sara.", true)[0] === "Hi, it's Sara.",
  'the opening turn and test voice keep their line',
)

const speakSrc = readFileSync(new URL('./speakSara.ts', import.meta.url), 'utf8')
assert(/splitSpeakChunks/.test(speakSrc), 'speakSara fetches one chunk at a time from the splitter')
assert(/chunks\.map/.test(speakSrc), 'later sentences are requested in parallel')
assert(/data-sara-voice/.test(speakSrc), 'one persistent audio element is marked in the DOM')
assert(/appendChild/.test(speakSrc), 'the element is appended once')
assert(/playsInline/.test(speakSrc), 'the element is playsInline')
assert(/preload = 'auto'/.test(speakSrc), 'the element preloads')
assert(/ADVANCE_LIMIT_MS = 1500/.test(speakSrc), 'currentTime must advance within 1.5s')
assert(/0\.25 \+ /.test(speakSrc) && /0\.65/.test(speakSrc), 'synthetic envelope stays in 0.25-0.9')
assert(/addEventListener\('ended'/.test(speakSrc), 'the next chunk starts from the ended event')
assert(/addEventListener\('playing'/.test(speakSrc), 'audible state follows the playing event')
assert(/playCachedSaraSpeech/.test(speakSrc), 'a fresh tap can replay cached chunks without waiting')
assert(!/AudioContext|webkitAudioContext|createAnalyser|decodeAudioData|createBufferSource|createMediaElementSource/.test(speakSrc), 'playback stays on the media element')
assert(!/audio\.load\(/.test(speakSrc), 'stop does not load() an audio element')
assert(!/speechSynthesis/.test(speakSrc), 'speakSara.ts has no speechSynthesis fallback')
const unlock = speakSrc.match(/export function unlockSaraSpeech\(\)[\s\S]*?\n\}/)?.[0] ?? ''
assert(/\.play\(/.test(unlock), 'unlock calls play() on the element')
assert(!/await|\.pause\(/.test(unlock), 'unlock does not await or pause (that re-locks the element)')
assert(/SILENT_WAV/.test(unlock), 'unlock plays the silent data URI')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/Sara is listening/.test(askSrc), 'Ask Sara shows the listening line as soon as Send runs')
assert(/unlockSaraSpeech\(\)/.test(askSrc), 'Send unlocks audio inside the tap')
assert(/SARA_TEST_VOICE_LINE/.test(askSrc), 'Test voice speaks one fixed sentence through /speak')
assert(/data-sara-test-voice/.test(askSrc), 'Test voice is a tap on Ask Sara')
assert(/voiceOnly[\s\S]{0,400}Test voice/.test(askSrc), 'Test voice is only on the demo pass')
assert(/SARA_TAP_TO_HEAR/.test(askSrc), 'playback failure shows Tap to hear Sara')
assert(/SARA_SILENT_SWITCH_HINT/.test(askSrc), 'playback failure names the Silent switch and the volume')
assert(/playCachedSaraSpeech\(\)/.test(askSrc), 'Tap to hear retries cached audio inside the tap')
const hear = askSrc.match(/const hearFromTap = \(\) => \{[\s\S]*?\n  \}/)?.[0] ?? ''
assert(/playCachedSaraSpeech\(\)/.test(hear) && !/await/.test(hear), 'the retry tap does not await before play()')

const portrait = readFileSync(new URL('../components/TalkingPortrait.tsx', import.meta.url), 'utf8')
assert(/data-sara-phase/.test(portrait), 'portrait exposes listening and speaking phases')
assert(/subscribeSaraLevel/.test(portrait), 'speaking glow follows the speech envelope')
assert(/data-sara-audible/.test(portrait), 'the ring is gated on verified playback')
assert(/sara-glow/.test(portrait), 'portrait has a glow ring')

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
assert(/sara-breathe/.test(css), 'idle portrait breathes')
assert(/sara-speak/.test(css), 'speaking portrait sways')
assert(/prefers-reduced-motion/.test(css), 'motion respects prefers-reduced-motion')
assert(/--sara-level/.test(css), 'glow ring uses the audio level')
assert(/data-sara-audible/.test(css), 'glow and sway run only while playback is verified')

if (process.exitCode) {
  console.error('speak chunk smoke failed')
  process.exit(1)
}
console.log('speak chunk smoke passed')
