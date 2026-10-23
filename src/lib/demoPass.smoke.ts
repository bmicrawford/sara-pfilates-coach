import { readFileSync } from 'node:fs'
import { APPROVED_CLAIMS } from '../../server/saraGuardrails.mjs'
import { SARA_BUSY_MESSAGE as SERVER_BUSY } from '../../server/demoGate.mjs'
import { askIntro, askEmptyHint, homeIntro, PROSPECT_ASK_GREETING, PROSPECT_HOME_NOTE, PROSPECT_NO_IDENTITY, PROSPECT_REDEEM_NOTE, PROSPECT_WELCOME, promptsForNameOrDob, redeemAsksForEmail } from './prospectCopy.ts'
import { isDemoPass, isDemoVoiceOnly } from './demoPass.ts'
import {
  DEMO_DID_FRAME_BUDGET_MS,
  DEMO_DID_SYNC_MS,
  didWebRtcSilencedBySilentSwitch,
  planDemoVoice,
} from './demoVoicePlan.ts'
import { DEMO_DEVICE_EMAIL, DEMO_TOKEN, redeemDemoPass } from './mockServer.ts'
import { isSaraBusy, messageForSaraStatus, SARA_BUSY_MESSAGE, SARA_UNKNOWN_PASS_MESSAGE } from './saraGate.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(isDemoPass('demo-sara-001') && isDemoPass(DEMO_TOKEN), 'demo pass matches DEMO-SARA-001')
assert(!isDemoPass('SARA-ABCD-EFGH-JKLM-NPQR'), 'a purchase pass is not the demo pass')
assert(!isDemoPass(''), 'a missing pass is not the demo pass')
assert(isDemoVoiceOnly(DEMO_TOKEN) === true, 'demo pass is voice-only')
assert(isDemoVoiceOnly('SARA-ABCD-EFGH-JKLM-NPQR') === false, 'paid pass keeps the talking head')
assert(promptsForNameOrDob(true) === false, 'demo users are not prompted for name or date of birth')
assert(promptsForNameOrDob(false) === true, 'paid users still get the name and date of birth step')
assert(redeemAsksForEmail(true) === false, 'demo redeem does not ask for an email')
assert(redeemAsksForEmail(false) === true, 'paid redeem still asks for an email')

const paidAsk = askIntro(false, false, false)
const demoAsk = askIntro(true, false, false)
assert(paidAsk.title === "Hey — it's Sara.", 'paid greeting stays the peer hello')
assert(!paidAsk.title.includes('PfilAtes') && !paidAsk.sub.includes('$149'), 'paid greeting has no prospect pitch')
assert(demoAsk.title === PROSPECT_ASK_GREETING, 'demo greeting invites a question about PfilAtes')
assert(demoAsk.title.includes('PfilAtes™'), 'demo greeting uses the PfilAtes™ spelling')
assert(demoAsk.sub.includes('AI coach, not a doctor'), 'demo Ask Sara says she is an AI coach, not a doctor')
assert(!/bought|diary history|your course/i.test(`${demoAsk.title} ${demoAsk.sub}`), 'demo greeting does not assume a purchase or a diary')
assert(askIntro(true, true, false).title === "I'm with you.", 'a live demo reply still says Sara is with you')
assert(/PfilAtes™/.test(askEmptyHint(true)) && !/why did I leak/i.test(askEmptyHint(true)), 'demo empty state does not assume a leak history')
assert(/why did I leak/i.test(askEmptyHint(false)), 'paid empty state keeps the diary-style prompts')

const paidHome = homeIntro(false)
const demoHome = homeIntro(true)
assert(paidHome.note === null && paidHome.greeting === '', 'paid home does not use the prospect note')
assert(demoHome.greeting === PROSPECT_ASK_GREETING, 'demo home leads with the prospect question')
assert(demoHome.note === PROSPECT_HOME_NOTE, 'demo home note is the prospect block')

for (const claim of [
  '80% of people who use the PfilAtes™ program (or at least 50%) improved in 28 days of training.',
  'It takes 10 minutes a day.',
  "The women's course is a $149 lifetime purchase.",
  'It was created by Dr. Bruce Crawford.',
]) {
  assert(APPROVED_CLAIMS.includes(claim), `approved claim list still has: ${claim}`)
  assert(PROSPECT_HOME_NOTE.includes(claim), `demo home repeats approved claim: ${claim}`)
  assert(PROSPECT_WELCOME.includes(claim), `welcome repeats approved claim: ${claim}`)
  assert(PROSPECT_REDEEM_NOTE.includes(claim), `demo redeem repeats approved claim: ${claim}`)
}
assert(!/74%/.test(PROSPECT_HOME_NOTE + PROSPECT_WELCOME + PROSPECT_REDEEM_NOTE), 'prospect screens do not quote 74%')
assert(/Kajabi/.test(PROSPECT_HOME_NOTE) && /sits alongside/.test(PROSPECT_HOME_NOTE), 'demo copy says the course stays on Kajabi and Sara sits alongside it')
assert(PROSPECT_NO_IDENTITY.includes('name') && PROSPECT_NO_IDENTITY.includes('date of birth'), 'demo report says name and date of birth are not collected')

assert(SARA_BUSY_MESSAGE === SERVER_BUSY, 'client busy copy matches the worker')
assert(
  messageForSaraStatus(429, { message: SARA_BUSY_MESSAGE }) === SARA_BUSY_MESSAGE,
  '429 becomes the busy line',
)
assert(messageForSaraStatus(429, {}) === SARA_BUSY_MESSAGE, '429 without a body still shows the busy line')
assert(isSaraBusy(SARA_BUSY_MESSAGE), 'busy helper matches the line')
assert(
  messageForSaraStatus(403, { error: 'unknown_pass', message: SARA_UNKNOWN_PASS_MESSAGE }) === SARA_UNKNOWN_PASS_MESSAGE,
  'unknown pass becomes a chat line instead of a crash',
)
assert(messageForSaraStatus(403, { error: 'demo_voice_only' }) === null, 'stream refusal is not spoken as a chat reply')
assert(
  messageForSaraStatus(429, { error: 'did_unavailable', message: '', reply: '' }) === null,
  'a D-ID cap 429 is not spoken and is not the busy line',
)
assert(messageForSaraStatus(200, { reply: 'Hello' }) === null, 'a normal reply is not treated as a gate')

assert(DEMO_DID_FRAME_BUDGET_MS === 3000, 'demo lip-sync budget is 3 seconds')
assert(DEMO_DID_SYNC_MS === 500, 'muted D-ID video only stays if ara starts within 500ms')
assert(didWebRtcSilencedBySilentSwitch('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iPhone WebRTC is treated as silenced by the Silent switch')
assert(
  didWebRtcSilencedBySilentSwitch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5),
  'iPadOS desktop UA is treated as silenced',
)
assert(!didWebRtcSilencedBySilentSwitch('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0'), 'desktop WebRTC is not treated as silenced')

const basePlan = {
  araStarted: false,
  didFailed: false,
  budgetExceeded: false,
  speechFramesLive: false,
  chunkReady: false,
  framesReadyAt: null,
  chunkReadyAt: null,
  now: 10_000,
  iosSilentSwitch: false,
}
assert(planDemoVoice(basePlan) === 'wait', 'demo waits while neither ara nor D-ID frames are ready')
assert(
  planDemoVoice({ ...basePlan, chunkReady: true, chunkReadyAt: 10_000 }) === 'ara',
  'first ara chunk plays immediately when D-ID frames are not live',
)
assert(
  planDemoVoice({ ...basePlan, budgetExceeded: true }) === 'ara',
  'the 3s budget falls back to ara when frames never arrive',
)
assert(planDemoVoice({ ...basePlan, didFailed: true, speechFramesLive: true, framesReadyAt: 9000 }) === 'ara', 'any D-ID failure falls back to ara')
assert(planDemoVoice({ ...basePlan, araStarted: true, speechFramesLive: true }) === 'ara', 'demo does not switch to D-ID mid-sentence')
assert(
  planDemoVoice({ ...basePlan, speechFramesLive: true, framesReadyAt: 9000 }) === 'did-audio',
  'desktop uses D-ID audio when speech frames are live before ara',
)
assert(
  planDemoVoice({
    ...basePlan,
    iosSilentSwitch: true,
    speechFramesLive: true,
    chunkReady: true,
    framesReadyAt: 10_000,
    chunkReadyAt: 10_400,
  }) === 'did-visual-ara',
  'iPhone keeps ara and uses muted D-ID video when they start together',
)
assert(
  planDemoVoice({
    ...basePlan,
    iosSilentSwitch: true,
    speechFramesLive: true,
    chunkReady: true,
    framesReadyAt: 8_000,
    chunkReadyAt: 10_000,
  }) === 'ara',
  'iPhone prefers ara when the D-ID mouth is already ahead',
)
assert(
  planDemoVoice({ ...basePlan, iosSilentSwitch: true, speechFramesLive: true, framesReadyAt: 9_500 }) === 'wait',
  'iPhone waits for the ara chunk when frames just became live',
)

const memory = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
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

const calls: string[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (url: string) => {
  calls.push(String(url))
  throw new Error('network')
}) as typeof fetch
try {
  const redeemed = await redeemDemoPass()
  assert(redeemed.ok === true, 'demo redeem succeeds without an email')
  if (redeemed.ok) {
    assert(redeemed.session.email === DEMO_DEVICE_EMAIL, 'demo session stores only the local placeholder')
    assert(redeemed.session.redeemToken === DEMO_TOKEN, 'demo session keeps the demo pass')
  }
  assert(calls.length === 0, 'demo redeem does not call the server')
  assert(!JSON.stringify([...memory.values()]).includes('XAI_API_KEY'), 'demo redeem does not store a secret')
} finally {
  globalThis.fetch = originalFetch
}

const askSrc = readFileSync(new URL('../pages/AskSara.tsx', import.meta.url), 'utf8')
const askClient = readFileSync(new URL('./askSara.ts', import.meta.url), 'utf8')
const speakSrc = readFileSync(new URL('./speakSara.ts', import.meta.url), 'utf8')
const streamSrc = readFileSync(new URL('./saraStream.ts', import.meta.url), 'utf8')
const welcome = readFileSync(new URL('../pages/Welcome.tsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
const redeem = readFileSync(new URL('../pages/Redeem.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const diary = readFileSync(new URL('../pages/DiaryReport.tsx', import.meta.url), 'utf8')
const exercise = readFileSync(new URL('../pages/ExerciseLog.tsx', import.meta.url), 'utf8')

assert(/voiceOnly/.test(askSrc) && /isDemoVoiceOnly/.test(askSrc), 'Ask Sara derives prospect copy from the demo pass')
assert(/if \(voiceOnly\)/.test(askSrc) && /speakDemoReply\(text\)/.test(askSrc), 'demo replies try D-ID then ara')
assert(/playAra\(text\)/.test(askSrc), 'paid replies still fall back to ara')
assert(/connectSaraStream\(\)/.test(askSrc), 'Send starts D-ID for the demo pass too')
assert(/DEMO_DID_FRAME_BUDGET_MS/.test(askSrc) && /planDemoVoice/.test(askSrc), 'demo lip-sync uses the 3s planner')
assert(/dropHeldSaraSpeech/.test(askSrc) && /releaseHeldSaraSpeech/.test(askSrc), 'demo plays one voice, never both')
assert(/did-visual-ara/.test(askSrc) && /settleSaraStreamVoice\('ara'\)/.test(askSrc), 'iPhone can keep muted video or hide a desynced stream')
assert(/live && streamCapped && !voiceOnly/.test(askSrc), 'demo D-ID fallback does not show the session-cap note')
{
  const mount = askSrc.match(/setSaraStreamCallbacks\([\s\S]*?preloadSaraStream\(\)/)?.[0] ?? ''
  assert(/preloadSaraStream\(\)/.test(mount), 'demo mount preloads the SDK')
  assert(!/connectSaraStream/.test(mount), 'demo mount does not open a D-ID session')
  assert(!/if \(voiceOnly\) \{\s*releaseSaraStream/.test(askSrc), 'demo mount does not skip SDK preload')
}
assert(/isSaraBusy\(reply\)/.test(askSrc), 'a 429 reply does not start playback')
assert(/pass: currentSaraPass\(\)/.test(askClient), 'Ask Sara sends the pass, not an email')
assert(!askClient.includes(DEMO_DEVICE_EMAIL), 'ask client does not send the demo placeholder')
assert(/pass: currentSaraPass\(\)/.test(speakSrc), '/speak sends the pass')
assert(/pass: currentSaraPass\(\)/.test(streamSrc), '/stream sends the pass for paid users')
assert(welcome.includes('PROSPECT_WELCOME') && !welcome.includes('Your course stays on Kajabi'), 'welcome uses prospect copy')
assert(/prospect \? \(/.test(home) && home.includes('PROSPECT_HOME_NOTE'), 'home has a prospect branch')
assert(/firstName\(session\.email\)/.test(home), 'paid home still greets from the saved profile')
{
  const paidHomeSrc = home.split(') : (')[1] ?? ''
  assert(paidHomeSrc.includes('firstName(session.email)'), 'paid home branch keeps the name greeting')
  assert(!paidHomeSrc.includes('PROSPECT_HOME_NOTE'), 'paid home branch does not include the prospect note')
}
assert(/redeemDemoPass/.test(redeem), 'demo redeem skips the email call')
assert(/redeemAsksForEmail\(prospect\) \? \(/.test(redeem), 'email field is the paid branch')
{
  const emailBranch = redeem.split('redeemAsksForEmail(prospect) ? (')[1]?.split(') : (')[0] ?? ''
  assert(emailBranch.includes('type="email"'), 'paid redeem still has an email field')
  assert(!emailBranch.includes('PROSPECT_REDEEM_NOTE'), 'email field is not the prospect note')
}
assert(/promptsForNameOrDob\(isDemoPass/.test(app), 'demo sessions skip the name and date of birth gate')
assert(/PatientOnboarding/.test(app), 'paid sessions still reach onboarding')
assert(diary.includes('PROSPECT_NO_IDENTITY') && diary.includes('Date of birth'), 'diary hides identity for demo and keeps it for paid')
assert(exercise.includes('PROSPECT_NO_IDENTITY') && exercise.includes('Date of birth'), 'exercise log hides identity for demo and keeps it for paid')
assert(/prospect \? \(/.test(diary) && /prospect \? \(/.test(exercise), 'identity blocks are conditional')

if (process.exitCode) {
  console.error('demo pass smoke failed')
  process.exit(1)
}
console.log('demo pass smoke passed')
