import { readFileSync } from 'node:fs'
import {
  armInstallCoach,
  clearInstallCoach,
  dismissInstallCoach,
  displayModeIsStandalone,
  isIosUserAgent,
  markInstallCoachInstalled,
  readInstallCoachStatus,
} from './installCoach.ts'
import { clearSession, readSession, redeemToken } from './mockServer.ts'

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

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error('FAIL', message)
    process.exitCode = 1
  }
}

assert(isIosUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), 'iPhone user agent is iOS')
assert(isIosUserAgent('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)'), 'iPad user agent is iOS')
assert(
  isIosUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5),
  'iPadOS desktop user agent is iOS',
)
assert(
  !isIosUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit Chrome/128.0.0.0 Mobile'),
  'Android Chrome is not the iOS coach',
)
assert(
  !isIosUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0),
  'desktop Mac without touch is not iOS',
)
assert(displayModeIsStandalone(true, false), 'display-mode standalone hides the coach')
assert(displayModeIsStandalone(false, true), 'iOS navigator.standalone hides the coach')
assert(!displayModeIsStandalone(false, false), 'a browser tab is not standalone')

armInstallCoach(true)
assert(readInstallCoachStatus() === null, 'an installed display does not arm the coach')
armInstallCoach(false)
assert(readInstallCoachStatus() === 'pending', 'a browser redeem arms the coach')
dismissInstallCoach()
assert(readInstallCoachStatus() === 'dismissed', 'Not now is remembered')
armInstallCoach(false)
assert(readInstallCoachStatus() === 'dismissed', 'a later redeem does not clear Not now')
markInstallCoachInstalled()
armInstallCoach(false)
assert(readInstallCoachStatus() === 'installed', 'a successful install is remembered')
clearInstallCoach()
assert(readInstallCoachStatus() === null, 'clearing storage lets the coach show again')

const redeemed = await redeemToken('DEMO-SARA-001', 'student@example.com')
assert(redeemed.ok === true, 'demo redeem still succeeds')
assert(readInstallCoachStatus() === 'pending', 'a successful redeem arms the Home Screen coach')
assert(readSession()?.email === 'student@example.com', 'redeem still saves the sticky session')
dismissInstallCoach()
const again = await redeemToken('DEMO-SARA-001', 'student@example.com')
assert(again.ok === true, 'the same phone can redeem again')
assert(readInstallCoachStatus() === 'dismissed', 'the same phone does not get the coach again after Not now')
clearSession()
assert(readSession() === null, 'New phone still clears the session')
assert(readInstallCoachStatus() === null, 'New phone clears the coach so the next redeem may show it')

function pngSize(relativePath: string): { width: number; height: number } {
  const bytes = readFileSync(new URL(relativePath, import.meta.url))
  assert(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${relativePath} is a PNG`,
  )
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const icon192 = pngSize('../../public/icons/icon-192.png')
const icon512 = pngSize('../../public/icons/icon-512.png')
const iconMaskable = pngSize('../../public/icons/icon-512-maskable.png')
assert(icon192.width === 192 && icon192.height === 192, 'install icon is 192 PNG')
assert(icon512.width === 512 && icon512.height === 512, 'install icon is 512 PNG')
assert(iconMaskable.width === 512 && iconMaskable.height === 512, 'maskable icon is 512 PNG')

const home = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
const welcome = readFileSync(new URL('../pages/Welcome.tsx', import.meta.url), 'utf8')
const coach = readFileSync(new URL('../components/InstallCoach.tsx', import.meta.url), 'utf8')
const onboarding = readFileSync(new URL('../pages/PatientOnboarding.tsx', import.meta.url), 'utf8')
assert(home.includes('<InstallCoach />'), 'Home shows the coach after redeem')
assert(onboarding.includes('<InstallCoach />'), 'the name gate shows the coach before Home')
assert(!welcome.includes('InstallCoach') && !welcome.includes('InstallHint'), 'Welcome does not coach before redeem')
assert(coach.includes('Share') && coach.includes('Add to Home Screen') && coach.includes('>Add<'), 'iOS coach lists Share, Add to Home Screen, Add')
assert(/disabled=\{busy\}[\s\S]*\bInstall\b/.test(coach), 'Android coach has an Install button')
assert(coach.includes('Add to Home screen') && coach.includes('Install app'), 'manual Chrome fallback is present')
assert(coach.includes('Not now'), 'the coach can be dismissed')

if (process.exitCode) {
  console.error('install coach smoke failed')
  process.exit(1)
}
console.log('install coach smoke passed')
