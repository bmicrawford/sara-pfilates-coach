import { readFileSync } from 'node:fs'
import { openEmailFromSearch, SARA_OPEN_WAITING } from './openSara.ts'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

assert(
  openEmailFromSearch('?e=jane+doe@example.com') === 'jane+doe@example.com',
  'an unencoded plus in {{ email }} is kept',
)
assert(
  openEmailFromSearch('https://sara-pfilates.surge.sh/open?e=jane%20doe@example.com') === 'jane+doe@example.com',
  'a space in the open link is treated as a plus',
)
assert(
  openEmailFromSearch('?e=Jane.Smith@Example.com') === 'Jane.Smith@Example.com',
  'a plain address is left for the server to normalize',
)
assert(
  SARA_OPEN_WAITING === 'We’re getting Sara ready. Try again in a minute',
  'the waiting line is the one buyers see',
)

const page = readFileSync(new URL('../pages/OpenSara.tsx', import.meta.url), 'utf8')
assert(page.includes('SARA_OPEN_WAITING') && page.includes('Try again') && page.includes('Purchase email'), 'Open Sara shows the waiting line, retry, and email field')
assert(page.includes('redeemToken') && page.includes('openSaraAccess'), 'a ready open uses the same redeem path as /r/:token')

if (process.exitCode) {
  console.error('openSara smoke failed')
  process.exit(1)
}
console.log('openSara smoke passed')
