#!/usr/bin/env node
/**
 * Mint one multi-use class redeem token on the Ask Sara Worker.
 * Students open the printed url, enter an email once, and that phone keeps the session.
 * The shared pass is not bound to one email. The same external id returns the same token.
 *
 *   REDEEM_MINT_SECRET=... SARA_WORKER_URL=https://sara-pfilates-ask.<account>.workers.dev \
 *     node scripts/mint-class-token.mjs class-cert-sac-2026-10-08
 *
 * Prints token and url only. Does not print the secret. Does not deploy.
 */

if (process.argv.includes('--self-test')) {
  await selfTest()
}

const secret = String(process.env.REDEEM_MINT_SECRET || '').trim()
const base = String(process.env.SARA_WORKER_URL || process.env.WORKER_URL || '')
  .trim()
  .replace(/\/$/, '')
const externalId = String(process.argv[2] || 'class-cert-sac-2026-10-08').trim()

if (!secret || !base) {
  console.error('Set REDEEM_MINT_SECRET and SARA_WORKER_URL (or WORKER_URL). Do not commit them.')
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

let res
try {
  res = await fetch(`${worker.origin}/redeem/mint`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ multiUse: true, externalId }),
    signal: AbortSignal.timeout(12_000),
  })
} catch (err) {
  console.error(`Mint request failed: ${err.cause?.message || err.message}`)
  process.exit(1)
}

const body = await res.json().catch(() => ({}))
const errorCode = typeof body?.error === 'string' && !body.error.includes(secret) ? body.error : ''
if (!res.ok || body?.ok !== true || typeof body.token !== 'string' || typeof body.url !== 'string') {
  console.error(`Mint failed: HTTP ${res.status}${errorCode ? ` ${errorCode}` : ''}`)
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      token: body.token,
      url: body.url,
      externalId: body.externalId ?? null,
      multiUse: body.multiUse === true,
      idempotent: body.idempotent === true,
    },
    null,
    2,
  ),
)

async function selfTest() {
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const fakeSecret = 'class-mint-secret-should-not-print'
  const token = 'SARA-ABCD-EFGH-JKLM-NPQR'
  const url = 'https://sara-pfilates.surge.sh/r/SARA-ABCD-EFGH-JKLM-NPQR'
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
          token,
          url,
          externalId: 'class-cert-sac-2026-10-08',
          multiUse: true,
          idempotent: false,
          secret: fakeSecret,
        }),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const child = spawn(process.execPath, [process.argv[1], 'class-cert-sac-2026-10-08'], {
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
    captured?.url === '/redeem/mint' &&
    captured?.authorization === `Bearer ${fakeSecret}` &&
    parsed.multiUse === true &&
    parsed.externalId === 'class-cert-sac-2026-10-08' &&
    parsed.email === undefined &&
    printed.token === token &&
    printed.url === url &&
    printed.multiUse === true &&
    !stdout.includes(fakeSecret) &&
    !stderr.includes(fakeSecret)
  if (!ok) {
    console.error('mint-class-token self-test failed')
    process.exit(1)
  }
  console.log('OK  mint-class-token posts multiUse and does not print the secret')
  process.exit(0)
}
