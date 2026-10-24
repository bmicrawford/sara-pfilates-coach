import { planDemoVoice } from './demoVoicePlan.ts'
import { captureSaraDebug, saraDebugOn, SARA_DEBUG_KEY, withSaraDebug } from './saraDebug.ts'
import {
  beginMutedGesturePlay,
  iosWebrtcMissed,
  IOS_WEBRTC_BUDGET_MS,
  playErrorName,
  SARA_SEE_LABEL,
  unmuteInPlace,
  type GestureVideo,
} from './saraStreamGesture.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

function fakeVideo(play: GestureVideo['play'], paused = false): GestureVideo & { attrs: Record<string, string>; removed: string[] } {
  const video = {
    muted: false,
    defaultMuted: false,
    paused,
    playsInline: false,
    volume: 1,
    attrs: {} as Record<string, string>,
    removed: [] as string[],
    setAttribute(name: string, value: string) {
      this.attrs[name] = value
    },
    removeAttribute(name: string) {
      this.removed.push(name)
      delete this.attrs[name]
    },
    play,
  }
  return video
}

{
  let calledSync = false
  const video = fakeVideo(() => {
    calledSync = true
    assert(video.muted === true, 'play() is called only after muted=true')
    assert(video.attrs.playsinline === 'true' && video.attrs['webkit-playsinline'] === 'true', 'gesture play sets playsinline and webkit-playsinline')
    return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  })
  const pending = beginMutedGesturePlay(video)
  assert(calledSync, 'muted play() runs before the gesture function returns')
  assert(video.muted === true && video.volume === 0, 'a rejected play() leaves the element muted')
  let name = ''
  await Promise.resolve(pending).then(
    () => {
      name = 'played'
    },
    (error: unknown) => {
      name = playErrorName(error)
    },
  )
  assert(name === 'NotAllowedError', 'a rejected play() keeps the DOMException name for debug')
}

{
  let plays = 0
  const video = fakeVideo(() => {
    plays += 1
    return Promise.resolve()
  }, true)
  video.muted = true
  const ok = unmuteInPlace(video)
  assert(ok === false, 'a paused video is not unmuted')
  assert(plays === 0, 'unmute does not call play()')
  assert(video.muted === true, 'paused unmute leaves muted=true')
}

{
  let plays = 0
  const video = fakeVideo(() => {
    plays += 1
    return Promise.resolve()
  }, false)
  video.muted = true
  const ok = unmuteInPlace(video)
  assert(ok === true && video.muted === false && video.removed.includes('muted'), 'an already-playing video unmutes in place')
  assert(plays === 0, 'in-place unmute does not call play() again')
}

assert(SARA_SEE_LABEL === 'Tap to see Sara', 'the face overlay says Tap to see Sara')
assert(IOS_WEBRTC_BUDGET_MS === 15_000, 'iOS WebRTC give-up is 15 seconds')
assert(!iosWebrtcMissed({ elapsedMs: 14_999, phase: 'connecting' }), 'just inside 15s the warm session may still connect')
assert(iosWebrtcMissed({ elapsedMs: 15_000, phase: 'connecting' }), '15s without a live session is a clean iOS fallback')
assert(iosWebrtcMissed({ elapsedMs: 15_000, phase: 'failed' }), 'a failed warm at 15s is the same fallback')
assert(!iosWebrtcMissed({ elapsedMs: 20_000, phase: 'live' }), 'a live session is not marked missed')

const memory = new Map<string, string>()
;(globalThis as { sessionStorage?: Storage }).sessionStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
} as Storage

captureSaraDebug('?debug=1')
assert(memory.get(SARA_DEBUG_KEY) === '1', 'debug=1 is stored before the redeem redirect')
assert(saraDebugOn('') === true, 'Ask Sara stays in debug after the query string is gone')
assert(withSaraDebug('/') === '/?debug=1', 'the home redirect keeps ?debug=1')
assert(withSaraDebug('/ask') === '/ask?debug=1', 'Ask Sara keeps ?debug=1')
memory.clear()
assert(saraDebugOn('?debug=1') === true, 'a debug query is on even before storage')
assert(withSaraDebug('/ask') === '/ask', 'without debug the Ask Sara url is unchanged')

const warm = {
  araStarted: false,
  didFailed: false,
  budgetExceeded: false,
  speechFramesLive: true,
  chunkReady: true,
  streamWarm: true,
}
assert(planDemoVoice(warm) === 'did-audio', 'a warm session with frames still uses D-ID audio')
assert(
  planDemoVoice({ ...warm, unmuteBlocked: true }) === 'did-visual-ara',
  'a rejected unmute keeps muted video and plays ara',
)
assert(
  planDemoVoice({ ...warm, speechFramesLive: false, framesVisible: true, unmuteBlocked: true, budgetExceeded: true }) ===
    'did-visual-ara',
  'visible frames are not hidden when unmuted play was rejected',
)
assert(
  planDemoVoice({ ...warm, speechFramesLive: false, budgetExceeded: true, chunkReady: true }) === 'ara',
  'no frames within 3s still falls back to ara and the still',
)

if (process.exitCode) {
  console.error('sara stream gesture smoke failed')
  process.exit(1)
}
console.log('sara stream gesture smoke passed')
