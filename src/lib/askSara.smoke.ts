import { isSaraUnreachable, SARA_OFFLINE } from './askSara.ts'
import { isSaraVideoLive, shouldShowSaraStream, isSaraSessionCapError, isTransientStreamError } from './saraStream.ts'
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
assert(/streamWarmup:\s*false/.test(streamSrc), 'Talks V2 warmup is off so connect() is not gated on decoded frames')
assert(/PLAY_RETRY_MS/.test(streamSrc), 'retries muted video.play() after srcObject')
assert(/pageshow/.test(streamSrc), 'replays muted video when iOS PWA returns to foreground')
assert(/isTransientStreamError/.test(streamSrc), 'treats early D-ID /streams 403 as retryable')
assert(/isSaraSessionCapError/.test(streamSrc), 'detects Forbidden / Max user sessions as a hard cap')
assert(/sessionCapped/.test(streamSrc), 'remembers the D-ID session cap so later Send/Play do not reconnect')
assert(/not retrying \(retries hold sessions\)/.test(streamSrc), 'logs session cap without retrying')
assert(/safeDisconnect/.test(streamSrc), 'releases the D-ID session on unmount and failed connect')
assert(/Keep sessionCapped/.test(streamSrc), 'dropManager does not clear the session cap')
assert(/\[sara-stream\]/.test(streamSrc), 'logs stream 403 / missing srcObject without secrets')
assert(/ck_\[redacted\]/.test(streamSrc), 'redacts client keys from stream logs')
assert(/elementHoldsStream/.test(streamSrc), '403 fallback checks the <video> srcObject, not a stale module flag')
assert(
  /D-ID \/streams 403 after retries/.test(streamSrc),
  'persistent 403 falls back to the still and keeps ara',
)
assert(
  !/isTransientStreamError\(error\) && session === sessionGen && manager && !deadMode/.test(streamSrc),
  '403 must not fake a successful connect when the video has no srcObject',
)
assert(
  isSaraSessionCapError({ kind: 'Forbidden', status: 403, message: 'Max user sessions reached' }),
  'Forbidden + Max user sessions is a session cap',
)
assert(
  isSaraSessionCapError({ kind: 'InsufficientCreditsError', status: 402, message: 'not enough credits' }),
  'zero D-ID credits is a hard cap, not a retry',
)
assert(
  !isSaraSessionCapError({ kind: 'PermissionError', status: 403, message: 'user has no permission for stitch' }),
  'other 403s are not the session cap',
)
assert(
  !isTransientStreamError({ kind: 'Forbidden', status: 403, message: 'Max user sessions reached' }),
  'session-cap 403 is not retried',
)
assert(
  isTransientStreamError({ status: 403, kind: 'AuthorizationError', message: 'user unauthenticated' }),
  'non-cap 403 can still be treated as a transient SDK retry',
)

assert(
  !shouldShowSaraStream({ streamReady: true, speaking: false, streamTalking: false, videoLive: false }),
  'keeps the still when streamReady is a false positive (Chromium PR8 hole)',
)
assert(
  !shouldShowSaraStream({ streamReady: true, speaking: true, streamTalking: false, videoLive: false }),
  'keeps the still over a black/empty track while ara talks',
)
assert(
  shouldShowSaraStream({ streamReady: false, speaking: false, streamTalking: false, videoLive: true }),
  'reveals muted video once the element has a playing srcObject — do not wait on START',
)
assert(
  shouldShowSaraStream({ streamReady: true, speaking: true, streamTalking: true, videoLive: true }),
  'shows muted stream while D-ID is talking and frames are live',
)
assert(
  !isSaraVideoLive(null),
  'null video is not live',
)
assert(
  !isSaraVideoLive({ srcObject: null, videoWidth: 0 } as HTMLVideoElement),
  'empty video (readyState 0, no srcObject) is not live',
)
assert(
  !isSaraVideoLive({ srcObject: {}, videoWidth: 0 } as HTMLVideoElement),
  'srcObject without decoded frames is not live',
)
assert(
  isSaraVideoLive({ srcObject: {}, videoWidth: 512 } as HTMLVideoElement),
  'decoded frames on a srcObject count as live',
)

assert(!/audio\.load\(/.test(speakSrc), 'stop does not load() the audio element (that re-locks iOS)')

const portraitSrc = readFileSync(new URL('../components/TalkingPortrait.tsx', import.meta.url), 'utf8')
assert(!/<svg[\s>]/.test(portraitSrc), 'TalkingPortrait has no SVG mouth overlay')
assert(!/talking\s*&&\s*videoUrl/.test(portraitSrc), 'portrait is not gated on Talks mp4')
assert(/streaming/.test(portraitSrc), 'portrait shows the live Agents stream')
assert(/playsInline/.test(portraitSrc), 'stream video is playsInline')
assert(/sara-stream-video/.test(portraitSrc), 'stream video stays painted under the still')
assert(/poster=\{STILL\}/.test(portraitSrc), 'video poster is the idle still so an empty track is not a hole')
assert(/overflow-hidden/.test(portraitSrc), 'crops the portrait circle with overflow-hidden like SaraPortrait')
assert(/opacity-100/.test(portraitSrc), 'idle still is opacity-100 unless the stream is actually live')
assert(/isSaraVideoLive/.test(portraitSrc), 'portrait reports live only when the video has srcObject + frames')

const cssSrc = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
assert(!/mask-image/.test(cssSrc), 'does not CSS-mask the portrait (iOS can composite that to a blank hole)')
assert(!/translateZ\(0\)/.test(cssSrc), 'does not promote the portrait onto a 3D layer that hides the still')

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/unlockSaraSpeech/.test(askSrc), 'Send still unlocks ara audio for iOS')
assert(/unlockSaraStream/.test(askSrc), 'Send unlocks the muted stream video on the same tap')
assert(
  /haltPlayback\(\)[\s\S]*unlockSaraSpeech\(\)[\s\S]*unlockSaraStream\(\)/.test(askSrc),
  'Send stops the previous reply before unlocking so load/halt cannot undo the gesture',
)
assert(/speakSara\(/.test(askSrc), 'ara TTS starts immediately on reply')
assert(/speakSaraStream/.test(askSrc), 'Agents stream speak runs alongside ara')
assert(/connectSaraStream\(\)/.test(askSrc), 'Send starts/joins stream connect in the same gesture as unlock')
assert(/SARA_STREAM_CAPPED_NOTE/.test(askSrc), 'Ask Sara surfaces session-cap status while ara talks')
assert(/disconnectSaraStream/.test(askSrc), 'Ask Sara disconnects the D-ID session on leave')
assert(!/agentManager\.chat\(|\.chat\(/.test(askSrc), 'Ask Sara does not call agentManager.chat()')
assert(!/requestSaraTalk/.test(askSrc), 'Ask Sara does not poll Talks mp4')
assert(!/watchSaraTalk/.test(askSrc), 'Ask Sara does not wait minutes for an mp4')

const mainSrc = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
assert(/registration\.update\(/.test(mainSrc), 'service worker checks for a new bundle')

const viteSrc = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
assert(/sara-pwa-20260917-sessions/.test(viteSrc), 'PWA cacheId busts a phone still serving the PR9 still bundle')
assert(/NetworkFirst/.test(viteSrc), 'navigations are NetworkFirst so iOS PWA gets new index.html')
assert(!/\*\.\{js,css,html/.test(viteSrc), 'does not precache index.html (stale PWA)')

if (process.exitCode) {
  console.error('askSara copy smoke failed')
  process.exit(1)
}
console.log('askSara copy smoke passed')
