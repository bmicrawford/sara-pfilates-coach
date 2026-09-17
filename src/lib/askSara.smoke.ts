import { isSaraUnreachable, SARA_OFFLINE } from './askSara.ts'
import { shouldShowSaraStream } from './saraStream.ts'
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
assert(!/requestSaraTalk/.test(speakSrc), 'client no longer waits on D-ID Talks mp4')

const streamSrc = readFileSync(new URL('./saraStream.ts', import.meta.url), 'utf8')
assert(/createAgentManager/.test(streamSrc), 'uses D-ID Agents SDK manager')
assert(/speak\(\{ type: 'text'/.test(streamSrc), 'drives the avatar with agentManager.speak()')
assert(/DirectPlayback/.test(streamSrc), 'speak-only DirectPlayback so a no-LLM agent keeps streamingManager')
assert(!/manager\.chat\(|created\.chat\(/.test(streamSrc), 'never calls agentManager.chat() — Grok is the brain')
assert(/\/stream/.test(streamSrc), 'fetches stream credentials from the Worker')
assert(!/DID_API_KEY/.test(streamSrc), 'Agents SDK client never sees DID_API_KEY')
assert(/muted = true/.test(streamSrc), 'WebRTC video is muted so ara is the voice')
assert(/onSrcObjectReady/.test(streamSrc), 'attaches the WebRTC stream on onSrcObjectReady')
assert(/onReady/.test(streamSrc), 'exposes streamReady so the still can yield before START')
assert(/unlockSaraStream/.test(streamSrc), 'replays muted video from the Send/Play gesture')
assert(/compatibilityMode: 'on'/.test(streamSrc), 'VP8 compatibility mode for Safari WebRTC')

assert(
  shouldShowSaraStream({ streamReady: true, speaking: true, streamTalking: false }),
  'reveals video when ara is talking even if D-ID START has not fired',
)
assert(
  shouldShowSaraStream({ streamReady: true, speaking: false, streamTalking: true }),
  'reveals video on D-ID START',
)
assert(
  !shouldShowSaraStream({ streamReady: true, speaking: false, streamTalking: false }),
  'keeps the still when connected but idle',
)
assert(
  !shouldShowSaraStream({ streamReady: false, speaking: true, streamTalking: false }),
  'keeps the still when ara talks but the stream is not attached',
)

const portraitSrc = readFileSync(new URL('../components/TalkingPortrait.tsx', import.meta.url), 'utf8')
assert(!/<svg[\s>]/.test(portraitSrc), 'TalkingPortrait has no SVG mouth overlay')
assert(!/talking\s*&&\s*videoUrl/.test(portraitSrc), 'portrait is not gated on Talks mp4')
assert(/streaming/.test(portraitSrc), 'portrait shows the live Agents stream')
assert(/playsInline/.test(portraitSrc), 'stream video is playsInline')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/unlockSaraSpeech/.test(askSrc), 'Send still unlocks ara audio for iOS')
assert(/unlockSaraStream/.test(askSrc), 'Send unlocks the muted stream video on the same tap')
assert(/speakSara\(/.test(askSrc), 'ara TTS starts immediately on reply')
assert(/speakSaraStream/.test(askSrc), 'Agents stream speak runs alongside ara')
assert(!/agentManager\.chat\(|\.chat\(/.test(askSrc), 'Ask Sara does not call agentManager.chat()')
assert(!/requestSaraTalk/.test(askSrc), 'Ask Sara does not poll Talks mp4')
assert(!/watchSaraTalk/.test(askSrc), 'Ask Sara does not wait minutes for an mp4')

if (process.exitCode) {
  console.error('askSara copy smoke failed')
  process.exit(1)
}
console.log('askSara copy smoke passed')
