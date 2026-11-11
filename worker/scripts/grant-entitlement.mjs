#!/usr/bin/env node
/**
 * Grant a Sara entitlement to someone who already bought, or who was comped.
 * Kajabi Payment Succeeded and Cart Purchase do not fire for granted access.
 * This does not send email. After it succeeds, that person can open
 * https://sara-pfilates.surge.sh/open?e=<their email>
 *
 *   REDEEM_MINT_SECRET=... SARA_WORKER_URL=https://sara-pfilates-ask.pfilates.workers.dev \
 *     node worker/scripts/grant-entitlement.mjs buyer@example.com 2147989270
 *
 * The offer id is optional (women's $149 is 2147989270, men's $149 is 2149556914).
 * An optional third argument is stored as the order id.
 * Prints the entitlement only. Does not print the secret. Does not deploy.
 */

if (process.argv.includes('--self-test')) {
  await selfTest()
}

const secret = String(process.env.REDEEM_MINT_SECRET || '').trim()
const base = String(process.env.SARA_WORKER_URL || process.env.WORKER_URL || '')
  .trim()
  .replace(/\/$/, '')
const email = String(process.argv[2] || '').trim()
const offerId = process.argv[3] ? String(process.argv[3]).trim() : ''
const orderId = process.argv[4] ? String(process.argv[4]).trim() : ''

if (!secret || !base) {
  console.error('Set REDEEM_MINT_SECRET and SARA_WORKER_URL (or WORKER_URL). Do not commit them.')
  process.exit(1)
}
if (!email) {
  console.error('Usage: node worker/scripts/grant-entitlement.mjs <email> [offerId] [orderId]')
  process.exit(1)
}

let worker
try {
  worker = new URL(base)
} catch {
  console.error('SARA_WORKER_URL must be an absolute URL.')
  process.exit(1)
}
const local = worker.hostname === 'localhost' || worker.hostname === '127.0.0.1'
if (worker.protocol !== 'https:' && !(worker.protocol === 'http:' && local)) {
  console.error('SARA_WORKER_URL must be https. http is only allowed for localhost.')
  process.exit(1)
}

const payload = { email }
if (offerId) payload.offerId = offerId
if (orderId) payload.orderId = orderId

let res
try {
  res = await fetch(`${worker.origin}/kajabi/grant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  })
} catch (err) {
  console.error(`Grant request failed: ${err.cause?.message || err.message}`)
  process.exit(1)
}

const body = await res.json().catch(() => ({}))
const errorCode = typeof body?.error === 'string' && !body.error.includes(secret) ? body.error : ''
if (!res.ok || body?.ok !== true || typeof body.email !== 'string') {
  console.error(`Grant failed: HTTP ${res.status}${errorCode ? ` ${errorCode}` : ''}`)
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      email: body.email,
      offerId: body.offerId ?? null,
      orderId: body.orderId ?? null,
      idempotent: body.idempotent === true,
      ts: body.ts ?? null,
    },
    null,
    2,
  ),
)

async function selfTest() {
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const fakeSecret = 'grant-secret-should-not-print'
  let captured = null
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      captured = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization || '',
        body: Buffer.concat(chunks).toString('utf8'),
      }
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          email: 'buyer@example.com',
          offerId: '2147989270',
          orderId: null,
          idempotent: false,
          ts: '2026-10-25T00:00:00.000Z',
          secret: fakeSecret,
        }),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const child = spawn(process.execPath, [process.argv[1], 'buyer@example.com', '2147989270'], {
    env: {
      ...process.env,
      REDEEM_MINT_SECRET: fakeSecret,
      SARA_WORKER_URL: `http://127.0.0.1:${port}`,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const code = await new Promise((resolve) => child.on('close', resolve))
  await new Promise((resolve) => server.close(resolve))
  const parsed = JSON.parse(captured?.body || '{}')
  const printed = JSON.parse(stdout)
  const ok =
    code === 0 &&
    stderr === '' &&
    captured?.method === 'POST' &&
    captured?.url === '/kajabi/grant' &&
    captured?.authorization === `Bearer ${fakeSecret}` &&
    parsed.email === 'buyer@example.com' &&
    parsed.offerId === '2147989270' &&
    printed.email === 'buyer@example.com' &&
    printed.offerId === '2147989270' &&
    printed.idempotent === false &&
    !stdout.includes(fakeSecret) &&
    !stderr.includes(fakeSecret)
  if (!ok) {
    console.error('grant-entitlement self-test failed')
    process.exit(1)
  }
  console.log('OK  grant-entitlement posts the email and does not print the secret')
  process.exit(0)
}
