#!/usr/bin/env node
/**
 * Watchdog for the durable Ask Sara origin.
 * Does not deploy, does not read XAI_API_KEY, does not call Surge.
 *
 *   npm run verify:ask-api -- https://sara-pfilates-ask.<account>.workers.dev
 *   VITE_SARA_API_URL=https://... npm run verify:ask-api
 *   npm run smoke:verify-api
 */

import { createServer } from 'node:http'
import {
  assertDurableSaraApiUrl,
  isEphemeralTunnel,
  surgeRebuildReminder,
  ttsIsAra,
  EXPECTED_TTS,
} from './saraApiUrl.mjs'

function ok(msg) {
  console.log(`OK    ${msg}`)
}

function fail(msg) {
  console.error(`FAIL  ${msg}`)
  process.exitCode = 1
}

async function checkHealth(base) {
  const url = `${base}/health`
  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    fail(`GET ${url} failed: ${err.cause?.message || err.message}`)
    fail(
      'Worker is not reachable. Human: wrangler deploy, then rebuild Surge with this URL — not a trycloudflare tunnel.',
    )
    return false
  }

  if (!res.ok) {
    fail(`GET ${url} → HTTP ${res.status}`)
    return false
  }

  let body
  try {
    body = await res.json()
  } catch {
    fail(`GET ${url} did not return JSON`)
    return false
  }

  let passed = true
  if (body?.ok === true) ok(`${url} ok=true`)
  else {
    fail(`${url} expected { ok: true }, got ${JSON.stringify(body)}`)
    passed = false
  }

  if (ttsIsAra(body?.tts)) ok(`tts=${body.tts} (expected ${EXPECTED_TTS})`)
  else {
    fail(`${url} expected tts=${EXPECTED_TTS} (xAI neural voice ara), got ${JSON.stringify(body?.tts)}`)
    passed = false
  }
  return passed
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve))
}

async function withHealthServer(payload, fn) {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }
    res.writeHead(404)
    res.end()
  })
  const port = await listen(server)
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    await closeServer(server)
  }
}

async function selfTest() {
  const tunnel = 'https://signal-filters-university-contrary.trycloudflare.com'
  try {
    assertDurableSaraApiUrl(tunnel, { requirePresent: true })
    fail('trycloudflare must be rejected')
  } catch (err) {
    if (/trycloudflare/i.test(err.message)) ok('rejects *.trycloudflare.com loudly')
    else fail(`wrong error for tunnel: ${err.message}`)
  }

  if (isEphemeralTunnel('https://foo.trycloudflare.com/ask')) ok('detects tunnel with a path')
  else fail('path-suffixed tunnel should still match')

  try {
    assertDurableSaraApiUrl('', { requirePresent: true })
    fail('empty URL must fail when required')
  } catch {
    ok('empty URL fails when required (verify) and is allowed when not (local Vite)')
  }

  const worker = assertDurableSaraApiUrl('https://sara-pfilates-ask.example.workers.dev/')
  if (worker === 'https://sara-pfilates-ask.example.workers.dev') ok('accepts *.workers.dev and strips slash')
  else fail(`workers.dev normalize: ${worker}`)

  if (ttsIsAra('ara') && ttsIsAra('ARA') && !ttsIsAra('alloy')) ok('health tts must be ara')
  else fail('ttsIsAra mismatch')

  const reminder = surgeRebuildReminder(worker)
  if (
    /VITE_SARA_API_URL=https:\/\/sara-pfilates-ask\.example\.workers\.dev/.test(reminder) &&
    /surge/i.test(reminder)
  ) {
    ok('prints Surge rebuild reminder with Worker URL')
  } else fail('missing Surge rebuild reminder')

  let selfFailed = Boolean(process.exitCode)
  process.exitCode = 0
  const araOk = await withHealthServer({ ok: true, tts: 'ara', model: 'grok-4.6' }, (base) =>
    checkHealth(base),
  )
  if (araOk && !process.exitCode) ok('GET /health with tts=ara passes')
  else {
    fail('expected tts=ara health to pass')
    selfFailed = true
  }

  process.exitCode = 0
  const wrongVoice = await withHealthServer({ ok: true, tts: 'alloy' }, (base) => checkHealth(base))
  if (!wrongVoice && process.exitCode) ok('GET /health with non-ara tts fails loudly')
  else {
    fail('non-ara tts should fail')
    selfFailed = true
  }

  if (selfFailed) {
    console.error('verify-sara-api self-test failed')
    process.exit(1)
  }
  process.exitCode = 0
  console.log('verify-sara-api self-test passed')
}

function printReminder(base) {
  console.log('')
  console.log(surgeRebuildReminder(base))
}

const args = process.argv.slice(2).filter((a) => a !== '--')
if (args.includes('--self-test')) {
  await selfTest()
} else {
  const raw =
    args.find((a) => !a.startsWith('-')) || process.env.VITE_SARA_API_URL || process.env.SARA_API_URL || ''
  let base = ''
  try {
    base = assertDurableSaraApiUrl(raw, { requirePresent: true })
    ok(`origin is durable (not trycloudflare): ${base}`)
  } catch (err) {
    fail(err.message)
    printReminder('')
    process.exit(1)
  }
  await checkHealth(base)
  printReminder(base)
  if (process.exitCode) process.exit(1)
}
