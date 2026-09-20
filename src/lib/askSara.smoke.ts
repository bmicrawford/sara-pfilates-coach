import { isSaraUnreachable, SARA_OFFLINE } from './askSara.ts'
import {
  isSaraVideoLive,
  shouldShowSaraStream,
  isSaraSessionCapError,
  isTransientStreamError,
  streamVideoShouldBeMuted,
  streamVideoShouldUnlockElement,
  STREAM_AV_READY_MS,
  STREAM_SRC_WAIT_MS,
  ensureDidStreamSessionBody,
} from './saraStream.ts'
import { SARA_VOICE_OFFLINE } from './speakSara.ts'
import { existsSync, readFileSync } from 'node:fs'
import { SARA_PORTRAIT_STILL } from './saraPortrait.ts'

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
assert(/rewritePfilatesForSpeech/.test(speakSrc), 'ara path rewrites PfilAtes before /speak')
assert(!/speechSynthesis/.test(speakSrc), 'speakSara.ts has no speechSynthesis fallback')
assert(!/trycloudflare/.test(speakSrc), 'speakSara.ts does not send people to trycloudflare')
assert(!/requestSaraTalk/.test(speakSrc), 'client no longer waits on D-ID Talks mp4')

const streamSrc = readFileSync(new URL('./saraStream.ts', import.meta.url), 'utf8')
assert(/rewritePfilatesForSpeech/.test(streamSrc), 'D-ID speak path rewrites PfilAtes before Jenny')
assert(/createAgentManager/.test(streamSrc), 'uses D-ID Agents SDK manager')
assert(/speak\(\{ type: 'text'/.test(streamSrc), 'drives the avatar with agentManager.speak()')
assert(/DirectPlayback/.test(streamSrc), 'speak-only DirectPlayback so a no-LLM agent keeps streamingManager')
assert(!/manager\.chat\(|created\.chat\(/.test(streamSrc), 'never calls agentManager.chat() — Grok is the brain')
assert(/\/stream/.test(streamSrc), 'fetches stream credentials from the Worker')
assert(!/DID_API_KEY/.test(streamSrc), 'Agents SDK client never sees DID_API_KEY')
assert(/applyHeardMute/.test(streamSrc), 'video mute follows D-ID-heard vs ara fallback')
assert(/volume = 1/.test(streamSrc), 'unmutes D-ID audio when stream speak is the heard voice')
assert(/STREAM_AV_READY_MS/.test(streamSrc), 'waits for playable AV after speak before ara')
assert(/STREAM_SRC_WAIT_MS/.test(streamSrc), 'falls back faster when srcObject never attaches')
assert(/gateAudioTracks/.test(streamSrc), 'disables WebRTC audio tracks until frames + speak')
assert(/maybePromoteHeard/.test(streamSrc), 'promotes heard voice only when speak started and frames are live')
assert(/readyState >= 2/.test(streamSrc), 'unmutes only after the video is playing decoded frames')
assert(/videoEl\.paused/.test(streamSrc), 'does not unmute a paused stream that has dimensions')
assert(/onFirstAudioDetected/.test(streamSrc), 'first audio does not unmute before video frames')
assert(/holding mute until video frames/.test(streamSrc), 'logs that early audio is held until frames')
assert(/Keep muted until did\+frames/.test(streamSrc), 'pending path stays muted so late play() can decode')
assert(/fallbackLocked/.test(streamSrc), 'late START after ara fallback must not unmute (no double voice)')
assert(/onSrcObjectReady/.test(streamSrc), 'attaches the WebRTC stream on onSrcObjectReady')
assert(/onSrcObjectReady empty — keeping existing srcObject/.test(streamSrc), 'finalize 400 flap does not drop srcObject')
assert(/onStreamCreated/.test(streamSrc), 'reads session_id from stream/created')
assert(/session_id — inserting from stream\/created/.test(streamSrc), 'patches SDP/ICE finalize when session_id is missing')
assert(/bindLateTracks/.test(streamSrc), 're-assigns srcObject when a late video track arrives')
assert(/addtrack/.test(streamSrc), 'listens for video tracks added after warmup-off connect')
assert(/framesArePlayable/.test(streamSrc), 'does not skip ara unless srcObject is playing frames')
assert(/onVoiceFallback/.test(streamSrc), 'heard path that dies later can start ara')
assert(/speak finished with no video srcObject/.test(streamSrc), 'missing srcObject after speak falls back to ara')
assert(/SessionError/.test(streamSrc), 'treats finalize session_id 400 as retryable, not a dead session')
assert(/onReady/.test(streamSrc), 'exposes streamReady so the still can yield before START')
assert(/unlockSaraStream/.test(streamSrc), 'unlocks stream video from the Send/Play gesture')
assert(/compatibilityMode: 'on'/.test(streamSrc), 'VP8 compatibility mode for Safari WebRTC')
assert(/streamWarmup:\s*false/.test(streamSrc), 'Talks V2 warmup is off so connect() is not gated on decoded frames')
assert(/PLAY_RETRY_MS/.test(streamSrc), 'retries video.play() after srcObject')
assert(/pageshow/.test(streamSrc), 'replays muted video when iOS PWA returns to foreground')
assert(/isTransientStreamError/.test(streamSrc), 'treats early D-ID /streams 403 as retryable')
assert(/isSaraSessionCapError/.test(streamSrc), 'detects Forbidden / Max user sessions as a hard cap')
assert(/sessionCapped/.test(streamSrc), 'remembers the D-ID session cap so later Send/Play do not reconnect')
assert(/not retrying \(retries hold sessions\)/.test(streamSrc), 'logs session cap without retrying')
assert(/safeDisconnect/.test(streamSrc), 'releases the D-ID session on unmount and failed connect')
assert(/Keep sessionCapped/.test(streamSrc), 'dropManager does not clear the session cap')
assert(!/warmSaraStream/.test(streamSrc), 'always-on WebRTC pre-warm is gone — idle must not open /streams')
assert(/preloadSaraStream/.test(streamSrc), 'SDK preload is available without minting or opening WebRTC')
assert(!/preloadSaraStream[\s\S]{0,220}connectSaraStream/.test(streamSrc), 'SDK preload does not call connect()')
assert(/releaseSaraStream/.test(streamSrc), 'debounces disconnect so StrictMode remount does not burn a slot')
assert(/RELEASE_MS/.test(streamSrc), 'delayed release reuses the in-flight session across remount')
assert(/pagehide/.test(streamSrc), 'releases the D-ID session on pagehide so a frozen PWA does not hold a slot')
assert(!/streamWanted && !sessionCapped/.test(streamSrc), 'pageshow does not restore a D-ID session after pagehide')
assert(/Promise\.all/.test(streamSrc), 'fetches client key and SDK in parallel on Send connect')
assert(/hasLiveManager/.test(streamSrc), 'reuses a connected manager before the video has frames')
assert(
  !/if \(manager && !deadMode && elementHoldsStream\(\)\) return true/.test(streamSrc),
  'must not drop a live session just because srcObject is not attached yet',
)
assert(
  /connected — no video frames yet; session kept for speak\(\)/.test(streamSrc),
  'connect keeps the session without gating speak() on decoded frames',
)
assert(
  !/connect finished with no video srcObject — keeping still/.test(streamSrc),
  'missing srcObject after connect is not treated as a failed session',
)
assert(
  /do not wait for ara/.test(streamSrc),
  'speak() does not wait for ara before D-ID speak()',
)
assert(
  /STREAM_AV_READY_MS/.test(streamSrc) && /falling back to ara/.test(streamSrc),
  'waits for playable AV after speak before ara fallback',
)
assert(
  !/STREAM_VOICE_BUDGET_MS/.test(streamSrc),
  'short START-only voice budget is gone — that unmuted before frames',
)
assert(
  !/Promise\.race\(\[\s*runAttempts/.test(streamSrc),
  'does not race connect+speak against a short overall timeout that starts ara early',
)
assert(
  /Do not start ara while D-ID is still coming up/.test(streamSrc),
  'speak() documents no ara while D-ID is still connecting or decoding',
)
assert(
  /Do not connect\(\) on Ask Sara mount/.test(streamSrc),
  'stream module documents no mount-time WebRTC',
)
assert(/\[sara-stream\]/.test(streamSrc), 'logs stream 403 / missing srcObject without secrets')
assert(/ck_\[redacted\]/.test(streamSrc), 'redacts client keys from stream logs')
assert(/elementHoldsStream/.test(streamSrc), '403 fallback checks the <video> srcObject, not a stale module flag')
assert(
  /D-ID \/streams 403 after retries/.test(streamSrc),
  'persistent 403 falls back to the still; ara is the fallback voice',
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
  'keeps the still over a black/empty track while the fallback voice talks',
)
assert(
  shouldShowSaraStream({ streamReady: false, speaking: false, streamTalking: false, videoLive: true }),
  'reveals stream video once the element has a playing srcObject — do not wait on START',
)
assert(
  shouldShowSaraStream({ streamReady: true, speaking: true, streamTalking: true, videoLive: true }),
  'shows stream while D-ID is talking and frames are live',
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
assert(STREAM_SRC_WAIT_MS >= 2000 && STREAM_SRC_WAIT_MS <= 4500, 'no-srcObject budget is short so ara is not silent forever')
assert(STREAM_AV_READY_MS >= STREAM_SRC_WAIT_MS && STREAM_AV_READY_MS <= 6000, 'frame budget is short once srcObject exists')
{
  const already = ensureDidStreamSessionBody(JSON.stringify({ answer: { type: 'answer', sdp: 'x' }, session_id: 'keep' }), 'other')
  assert(!already.patched && /"session_id":"keep"/.test(already.body), 'does not overwrite an existing session_id')
  const camel = ensureDidStreamSessionBody(JSON.stringify({ answer: { type: 'answer' }, sessionId: 'sid-1' }), null)
  assert(camel.patched && /"session_id":"sid-1"/.test(camel.body), 'copies camelCase sessionId onto session_id')
  const missing = ensureDidStreamSessionBody(JSON.stringify({ answer: { type: 'answer', sdp: 'x' } }), 'sid-2')
  assert(missing.patched && /"session_id":"sid-2"/.test(missing.body), 'inserts stream/created session_id when finalize omits it')
  const none = ensureDidStreamSessionBody(JSON.stringify({ answer: { type: 'answer' } }), null)
  assert(!none.patched, 'does not invent a session_id when none exists')
}
assert(
  streamVideoShouldBeMuted({ voicePath: 'idle', userMuted: false }),
  'idle stream video stays muted',
)
assert(
  streamVideoShouldBeMuted({ voicePath: 'ara', userMuted: false }),
  'ara fallback remutes D-ID so voices do not overlap',
)
assert(
  streamVideoShouldBeMuted({ voicePath: 'did', userMuted: true, videoLive: true }),
  'user mute keeps D-ID silent even when stream speak is heard',
)
assert(
  streamVideoShouldBeMuted({ voicePath: 'did', userMuted: false, videoLive: false }),
  'keeps D-ID silent after START until visible frames',
)
assert(
  streamVideoShouldBeMuted({ voicePath: 'pending', userMuted: false, videoLive: false }),
  'pending after Send/Play stays silent so audio cannot lead the mouth',
)
assert(
  streamVideoShouldBeMuted({ voicePath: 'pending', userMuted: false, videoLive: true }),
  'pending with frames stays silent until speak has started',
)
assert(
  !streamVideoShouldBeMuted({ voicePath: 'did', userMuted: false, videoLive: true }),
  'unmutes D-ID only when stream speak is heard and frames are live',
)
assert(
  !streamVideoShouldUnlockElement({ voicePath: 'pending', userMuted: false }),
  'pending stays muted so autoplay can decode after async connect',
)
assert(
  streamVideoShouldUnlockElement({ voicePath: 'did', userMuted: false }),
  'heard D-ID path may unlock the element',
)
assert(
  !streamVideoShouldUnlockElement({ voicePath: 'idle', userMuted: false }),
  'idle does not leave the element unlocked',
)

assert(!/audio\.load\(/.test(speakSrc), 'stop does not load() the audio element (that re-locks iOS)')

const portraitSrc = readFileSync(new URL('../components/TalkingPortrait.tsx', import.meta.url), 'utf8')
assert(!/<svg[\s>]/.test(portraitSrc), 'TalkingPortrait has no SVG mouth overlay')
assert(!/talking\s*&&\s*videoUrl/.test(portraitSrc), 'portrait is not gated on Talks mp4')
assert(/streaming/.test(portraitSrc), 'portrait shows the live Agents stream')
assert(/playsInline/.test(portraitSrc), 'stream video is playsInline')
assert(/sara-stream-video/.test(portraitSrc), 'stream video stays painted under the still')
assert(SARA_PORTRAIT_STILL === '/avatar/sara-default.png', 'shared Sara portrait is the D-ID idle still')
assert(
  existsSync(new URL('../../public/avatar/sara-default.png', import.meta.url)),
  'idle still file exists on disk',
)
assert(/SARA_PORTRAIT_STILL/.test(portraitSrc), 'TalkingPortrait idle uses the shared Sara portrait')
assert(/poster=\{STILL\}/.test(portraitSrc), 'video poster is the idle still so an empty track is not a hole')
assert(
  !/sara-neutral|sara-listening|sara-celebrate/.test(portraitSrc),
  'Ask Sara idle is not a mood gallery',
)

const homePortraitSrc = readFileSync(new URL('../components/SaraPortrait.tsx', import.meta.url), 'utf8')
assert(/SARA_PORTRAIT_STILL/.test(homePortraitSrc), 'Home portrait uses the shared Sara still')
assert(!/sara-neutral/.test(homePortraitSrc), 'Home does not swap in sara-neutral')
assert(!/sara-listening/.test(homePortraitSrc), 'Home does not swap in sara-listening')
assert(!/sara-celebrate/.test(homePortraitSrc), 'Home does not swap in sara-celebrate')
assert(!/AVATARS/.test(homePortraitSrc), 'Home does not stack a mood gallery of faces')

const homePageSrc = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
assert(/SaraPortrait/.test(homePageSrc), 'Home renders SaraPortrait')
assert(/overflow-hidden/.test(portraitSrc), 'crops the fullscreen portrait with overflow-hidden')
assert(/sara-portrait-cover/.test(portraitSrc), 'portrait uses cover layout so still + stream fill the viewport')
assert(/object-cover/.test(portraitSrc), 'still and stream video cover the portrait box')
assert(!/rounded-full/.test(portraitSrc), 'TalkingPortrait is not a circular crop on Ask Sara')
assert(/opacity-100/.test(portraitSrc), 'idle still is opacity-100 unless the stream is actually live')
assert(/isSaraVideoLive/.test(portraitSrc), 'portrait reports live only when the video has srcObject + frames')
assert(/setVideoNode/.test(portraitSrc), 'binds the stream video during commit so Send/Play can attach')
assert(/replaySaraStreamVideo/.test(portraitSrc), 'portrait play retries do not force-mute D-ID audio')
assert(!/video\.muted = true/.test(portraitSrc), 'portrait effect does not pin muted=true after bind')
assert(/^\s*muted\s*$/m.test(portraitSrc), 'video starts muted in JSX so idle autoplay can decode')

const cssSrc = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
assert(!/mask-image/.test(cssSrc), 'does not CSS-mask the portrait (iOS can composite that to a blank hole)')
assert(!/translateZ\(0\)/.test(cssSrc), 'does not promote the portrait onto a 3D layer that hides the still')
assert(/sara-portrait-cover/.test(cssSrc), 'cover layout pins the still and stream to the viewport')
assert(/ask-sara-panel/.test(cssSrc), 'overlay text box is defined in CSS')
assert(/ask-sara-chip/.test(cssSrc), 'header chips keep Home/Mute readable on the still')
assert(/backdrop-filter/.test(cssSrc), 'overlay stays see-through so the face remains visible')
assert(
  /\.ask-sara-panel[\s\S]*?background:\s*rgba\(246,\s*243,\s*238,\s*0\.(1[5-9]|2[0-5])\)/.test(cssSrc),
  'Q&A glass fill stays in the 0.15–0.25 see-through range',
)
assert(
  /\.ask-sara-note[\s\S]*?background:\s*rgba\(246,\s*243,\s*238,\s*0\.(1[5-9]|2[0-5])\)/.test(cssSrc),
  'note glass fill stays in the 0.15–0.25 see-through range',
)
assert(
  /\.ask-sara-panel[\s\S]*?backdrop-filter:\s*blur\([1-6]px\)/.test(cssSrc),
  'Q&A glass uses a light blur so the face is not frosted over',
)
{
  const noHaloCopy = [
    'ask-sara-chip',
    'ask-sara-greeting',
    'ask-sara-greeting-lead',
    'ask-sara-panel',
    'ask-sara-note',
  ]
  for (const name of noHaloCopy) {
    const block = cssSrc.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
    assert(Boolean(block), `${name} overlay rule is defined in CSS`)
    assert(
      !/text-shadow:/.test(block) || /text-shadow:\s*none/.test(block),
      `${name} has no cream/white text-shadow halo`,
    )
    assert(
      /font-weight:\s*(600|700)/.test(block),
      `${name} copy is semibold or bold`,
    )
  }
}
assert(
  /\.ask-sara-stage[\s\S]*inset:\s*0/.test(cssSrc),
  'Ask Sara stage is edge-to-edge behind the overlay',
)
{
  const overlayCopy = [
    'ask-sara-chip',
    'ask-sara-greeting',
    'ask-sara-panel',
    'ask-sara-note',
    'ask-sara-input',
  ]
  for (const name of overlayCopy) {
    const block = cssSrc.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
    assert(
      /color:\s*(#000|#000000|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))/.test(block),
      `${name} copy is pure black so it reads on glass`,
    )
    assert(
      !/#3d3a36|#2f2c28|#3D3A36|#2F2C28/.test(block),
      `${name} does not use warm ink grey`,
    )
  }
}

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
assert(/unlockSaraSpeech/.test(askSrc), 'Send still unlocks ara audio for iOS fallback')
assert(/unlockSaraStream/.test(askSrc), 'Send unlocks the stream video on the same tap')
assert(
  /haltPlayback\(\)[\s\S]*unlockSaraSpeech\(\)[\s\S]*unlockSaraStream\(\)/.test(askSrc),
  'Send stops the previous reply before unlocking so load/halt cannot undo the gesture',
)
assert(/speakSara\(/.test(askSrc), 'ara TTS remains the fallback voice')
assert(/speakSaraStream/.test(askSrc), 'Agents stream speak is the primary voice path')
assert(
  /await speakSaraStream\(text\)/.test(askSrc),
  'waits for stream speak before deciding ara fallback',
)
assert(
  /outcome === 'heard'/.test(askSrc),
  'skips ara when D-ID stream audio is heard',
)
assert(
  /no playable AV/.test(askSrc),
  'ara waits until stream failure / cap / timeout with no playable AV',
)
assert(
  !/void speakSaraStream\(text\)\s*\n\s*if \(mutedRef/.test(askSrc),
  'ara is not started in parallel with stream speak',
)
assert(/streamVoiceRef/.test(askSrc), 'late D-ID STOP does not cancel an ara fallback that is already talking')
assert(/onVoiceFallback/.test(askSrc), 'Ask Sara starts ara if a heard D-ID path later loses video')
assert(/playAra/.test(askSrc), 'ara fallback is idempotent so return+callback cannot double-speak')
assert(/settleSaraStreamVoice/.test(askSrc), 'unreachable Grok remutes a pending stream unlock')
assert(/setSaraStreamUserMuted/.test(askSrc), 'Ask Sara forwards mute so D-ID audio respects Mute')
assert(/setSaraStreamUserMuted/.test(streamSrc), 'stream module tracks user mute without importing speakSara')
assert(!/warmSaraStream/.test(askSrc), 'Ask Sara does not pre-warm a D-ID session on mount')
assert(/preloadSaraStream\(\)/.test(askSrc), 'Ask Sara may preload the SDK on mount without opening WebRTC')
assert(/connectSaraStream\(\)/.test(askSrc), 'Send starts mint + WebRTC in the same gesture as unlock')
{
  const mountEffect = askSrc.match(/setSaraStreamCallbacks\([\s\S]*?stopSaraSpeech\(\)/)?.[0] || ''
  assert(Boolean(mountEffect), 'Ask Sara mount effect is present')
  assert(!/connectSaraStream|warmSaraStream/.test(mountEffect), 'mount effect does not open a D-ID session')
  assert(/preloadSaraStream\(\)/.test(mountEffect), 'mount effect only preloads the SDK')
  assert(/releaseSaraStream/.test(mountEffect), 'unmount releases the D-ID session')
}
assert(/SARA_STREAM_CAPPED_NOTE/.test(askSrc), 'Ask Sara surfaces session-cap status while ara talks')
assert(/releaseSaraStream/.test(askSrc), 'Ask Sara releases the D-ID session on leave')
assert(!/disconnectSaraStream/.test(askSrc), 'Ask Sara uses delayed release, not an immediate disconnect on unmount')
assert(/ask-sara-stage/.test(askSrc), 'Ask Sara keeps a dedicated fullscreen stage for the portrait')
assert(/ask-sara-panel/.test(askSrc), 'questions and answers sit in a transparent overlay panel')
assert(/ask-sara-input/.test(askSrc), 'compose uses a high-contrast field over the video')
assert(/ask-sara-overlay/.test(askSrc), 'chrome and thread overlay the avatar instead of pushing it up')
assert(/ask-sara-chip/.test(askSrc), 'header controls use contrast chips over the video')
assert(/ask-sara-greeting-lead/.test(askSrc), 'greeting title uses the bold lead class')
assert(/font-semibold/.test(askSrc), 'Ask Sara readable copy uses semibold Tailwind weights')
assert(/font-bold/.test(askSrc), 'greeting title is bold')
assert(/placeholder:text-ink-faint/.test(askSrc), 'compose placeholder may stay slightly softer than typed text')
assert(/bg-sage/.test(askSrc) && /text-white/.test(askSrc), 'Send stays a sage/white control')
{
  const copySrc = askSrc.replace(/placeholder:text-ink-faint/g, '')
  assert(!/\btext-ink\b/.test(copySrc), 'Ask Sara readable copy does not use warm text-ink')
  assert(!/text-ink-mute/.test(copySrc), 'Ask Sara readable copy does not use muted ink grey')
  assert(!/text-sage-deep/.test(copySrc), 'Ask Sara answers and questions are not sage-deep')
}
assert(!/bg-cream-card/.test(askSrc), 'Ask Sara does not use opaque cream cards over the face')
assert(!/agentManager\.chat\(|\.chat\(/.test(askSrc), 'Ask Sara does not call agentManager.chat()')
assert(!/requestSaraTalk/.test(askSrc), 'Ask Sara does not poll Talks mp4')
assert(!/watchSaraTalk/.test(askSrc), 'Ask Sara does not wait minutes for an mp4')

const mainSrc = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
assert(/registration\.update\(/.test(mainSrc), 'service worker checks for a new bundle')

const viteSrc = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
assert(/sara-pwa-20260920-home-sara-portrait/.test(viteSrc), 'PWA cacheId busts a phone still serving mood-gallery Home faces')
assert(/NetworkFirst/.test(viteSrc), 'navigations are NetworkFirst so iOS PWA gets new index.html')
assert(!/\*\.\{js,css,html/.test(viteSrc), 'does not precache index.html (stale PWA)')

if (process.exitCode) {
  console.error('askSara copy smoke failed')
  process.exit(1)
}
console.log('askSara copy smoke passed')
