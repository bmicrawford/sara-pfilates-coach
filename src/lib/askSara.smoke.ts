import { isSaraUnreachable, SARA_OFFLINE } from './askSara.ts'
import { SARA_VOICE_OFFLINE } from './speakSara.ts'
import { readFileSync } from 'node:fs'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(/couldn't reach my brain/i.test(SARA_OFFLINE), 'ask offline copy is honest reconnect')
assert(/try again/i.test(SARA_OFFLINE), 'ask offline copy asks to retry')
assert(!/trycloudflare|tunnel|proxy/i.test(SARA_OFFLINE), 'ask offline copy is not tunnel/dev jargon')
assert(isSaraUnreachable(SARA_OFFLINE), 'unreachable helper matches the offline line')
assert(!isSaraUnreachable('Sip water through the day.'), 'reachable Grok copy is not treated as down')

assert(/couldn't reach my voice/i.test(SARA_VOICE_OFFLINE), 'voice offline copy is honest reconnect')
assert(/Play/i.test(SARA_VOICE_OFFLINE), 'voice offline copy points at Play')
assert(!/speechSynthesis|Web Speech/i.test(SARA_VOICE_OFFLINE), 'does not advertise OS speech as the path')

const speakSrc = readFileSync(new URL('./speakSara.ts', import.meta.url), 'utf8')
assert(!/speechSynthesis/.test(speakSrc), 'speakSara.ts has no speechSynthesis fallback')
assert(!/trycloudflare/.test(speakSrc), 'speakSara.ts does not send people to trycloudflare')

if (process.exitCode) {
  console.error('askSara copy smoke failed')
  process.exit(1)
}
console.log('askSara copy smoke passed')
