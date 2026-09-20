import { PFILATES_SPOKEN, rewritePfilatesForSpeech } from './pfilatesSpeech.mjs'
import { readFileSync } from 'node:fs'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(PFILATES_SPOKEN === 'fill-ah-tees', 'spoken form is fill-ah-tees (fil + la + tees)')
assert(
  rewritePfilatesForSpeech('PfilAtes') === 'fill-ah-tees',
  'brand casing PfilAtes → fill-ah-tees',
)
assert(rewritePfilatesForSpeech('Pfilates') === 'fill-ah-tees', 'Pfilates → fill-ah-tees')
assert(rewritePfilatesForSpeech('pfilates') === 'fill-ah-tees', 'pfilates → fill-ah-tees')
assert(rewritePfilatesForSpeech('PFILATES') === 'fill-ah-tees', 'PFILATES → fill-ah-tees')
assert(
  rewritePfilatesForSpeech('Try this PfilAtes squeeze today.') ===
    'Try this fill-ah-tees squeeze today.',
  'rewrites a mention inside a Grok sentence',
)
assert(
  rewritePfilatesForSpeech('PfilAtes now, then more pfilates later.') ===
    'fill-ah-tees now, then more fill-ah-tees later.',
  'rewrites every case-insensitive mention',
)
assert(
  rewritePfilatesForSpeech('Pause PfilAtes, then restart PfilAtes.') ===
    'Pause fill-ah-tees, then restart fill-ah-tees.',
  'keeps surrounding punctuation and words',
)
assert(
  rewritePfilatesForSpeech('Pilates is not the brand.') === 'Pilates is not the brand.',
  'does not rewrite Pilates',
)
assert(rewritePfilatesForSpeech('') === '', 'empty text is unchanged')
assert(
  rewritePfilatesForSpeech('Sip water through the day.') === 'Sip water through the day.',
  'copy without the brand is unchanged',
)
assert(
  rewritePfilatesForSpeech('fill-ah-tees') === 'fill-ah-tees',
  'spoken form is idempotent',
)

const helperSrc = readFileSync(new URL('./pfilatesSpeech.mjs', import.meta.url), 'utf8')
assert(/fill-ah-tees/.test(helperSrc), 'helper documents fill-ah-tees')
assert(/Filates/.test(helperSrc), 'helper explains why not Filates')
assert(!/<phoneme/.test(helperSrc), 'shared form is not SSML — D-ID speak is plain text')

const serverSpeakSrc = readFileSync(new URL('../../server/speakSara.mjs', import.meta.url), 'utf8')
assert(
  /rewritePfilatesForSpeech/.test(serverSpeakSrc),
  'server clipSpeakText uses the same helper',
)

const speakSrc = readFileSync(new URL('./speakSara.ts', import.meta.url), 'utf8')
assert(
  /rewritePfilatesForSpeech/.test(speakSrc),
  'ara fetchSaraSpeech / speakSara uses the shared rewrite',
)

const streamSrc = readFileSync(new URL('./saraStream.ts', import.meta.url), 'utf8')
assert(
  /rewritePfilatesForSpeech/.test(streamSrc),
  'D-ID speakSaraStream uses the shared rewrite',
)

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/\{m\.text\}/.test(askSrc), 'Ask Sara still renders Grok text, not the spoken form')
assert(
  !/rewritePfilatesForSpeech/.test(askSrc),
  'Ask Sara does not rewrite on-screen chat',
)

const homeSrc = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
assert(/PfilAtes/.test(homeSrc), 'Home keeps on-screen PfilAtes spelling')
assert(!/fill-ah-tees/.test(homeSrc), 'Home does not show the spoken form')

if (process.exitCode) {
  console.error('pfilatesSpeech smoke failed')
  process.exit(1)
}
console.log('pfilatesSpeech smoke passed')
