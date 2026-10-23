/**
 * Headless demo of Ask Sara against the built app.
 * Mocks /ask and /speak. Proves the listening state shows during the
 * round trip, audio is unlocked inside the Send tap, speech is fetched
 * in parallel and scheduled gaplessly, and the demo path does not open D-ID.
 *
 *   npm run build && npm run smoke:voice-ui
 */

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'

const DIST = join(process.cwd(), 'dist')
const ARTIFACTS = '/opt/cursor/artifacts'
const CHROME = '/usr/bin/google-chrome'
const PORT = 43148
const DEBUG_PORT = 9334

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
    throw new Error(msg)
  }
  console.log('OK ', msg)
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('voice-ui smoke needs dist/. Run npm run build first.')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error('voice-ui smoke needs google-chrome')
  process.exit(1)
}

function toneWav(seconds = 0.35, freq = 440, sampleRate = 22050) {
  const n = Math.floor(sampleRate * seconds)
  const data = n * 2
  const buf = Buffer.alloc(44 + data)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + data, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(data, 40)
  for (let i = 0; i < n; i += 1) {
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate)
    buf.writeInt16LE(Math.floor(sample * 12000), 44 + i * 2)
  }
  return buf
}

const WAV = toneWav()
const REPLY = 'Sip water through the day. A glass with meals is plenty. Log what you notice.'
const traffic = {
  paths: [],
  askArrived: 0,
  askDone: 0,
  speaks: [],
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  traffic.paths.push(`${req.method} ${url.pathname}`)
  if (req.method === 'POST' && url.pathname === '/ask') {
    traffic.askArrived = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 900))
    traffic.askDone = Date.now()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ reply: REPLY }))
    return
  }
  if (req.method === 'POST' && url.pathname === '/speak') {
    const body = await readBody(req)
    const row = { at: Date.now(), text: String(body.text || ''), pass: String(body.pass || ''), doneAt: 0 }
    traffic.speaks.push(row)
    await new Promise((resolve) => setTimeout(resolve, 700))
    row.doneAt = Date.now()
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' })
    res.end(WAV)
    return
  }
  if (req.method === 'POST' && (url.pathname === '/stream' || url.pathname === '/talk')) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'demo must not open D-ID' }))
    return
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  if (!rel || rel.includes('..')) rel = 'index.html'
  let file = join(DIST, rel)
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
})

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

const userData = await mkdtemp(join(tmpdir(), 'sara-voice-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--autoplay-policy=document-user-activation-required',
  `--user-data-dir=${userData}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  'about:blank',
], { stdio: 'ignore' })

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function browserVersion() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return res.json()
    } catch {
      /* chrome still starting */
    }
    await sleep(100)
  }
  throw new Error('Chrome DevTools did not come up')
}

let ws
try {
  await browserVersion()
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = list.find((item) => item.type === 'page')
  assert(page?.webSocketDebuggerUrl, 'Chrome opened a page target')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', () => reject(new Error('devtools websocket failed')))
  })

  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (!msg.id || !pending.has(msg.id)) return
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  })
  const send = (method, params = {}) => {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluate failed')
    }
    return result.result?.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__saraAudio = { starts: [], resumes: 0 };
      const origStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(when) {
        window.__saraAudio.starts.push(typeof when === 'number' ? when : 0);
        return origStart.apply(this, arguments);
      };
      const origResume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = function() {
        window.__saraAudio.resumes += 1;
        return origResume.apply(this, arguments);
      };
    `,
  })

  const origin = `http://127.0.0.1:${PORT}`
  await send('Page.navigate', { url: origin })
  await sleep(400)
  await evaluate(`(() => {
    localStorage.setItem('sara.session', JSON.stringify({
      email: 'prospect@demo.local',
      redeemToken: 'DEMO-SARA-001',
      deviceId: 'device-voice-ui',
      redeemedAt: '2026-10-23T18:00:00.000Z',
    }));
    localStorage.setItem('sara.deviceId', JSON.stringify('device-voice-ui'));
    localStorage.removeItem('sara.chat');
    localStorage.removeItem('sara.voiceMuted');
    return true;
  })()`)
  await send('Page.navigate', { url: `${origin}/ask` })
  await sleep(600)
  await evaluate(`(async () => {
    if (!navigator.serviceWorker) return true;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
    return true;
  })()`)
  await send('Page.reload', { ignoreCache: true })
  await sleep(500)

  const ready = await waitFor(evaluate, `Boolean(document.querySelector('textarea'))`)
  assert(ready, 'Ask Sara composer is on the built demo page')

  await evaluate(`(() => {
    const el = document.querySelector('textarea');
    const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    proto.set.call(el, 'How much water should I drink?');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`)
  const box = await evaluate(`(() => {
    const el = document.querySelector('button[type="submit"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: el.disabled, label: el.textContent };
  })()`)
  assert(box && box.disabled === false && /Send to Sara/.test(box.label), 'Send is enabled before the tap')

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })

  await sleep(250)
  const listening = await evaluate(`(() => {
    const phase = document.querySelector('[data-sara-phase]')?.getAttribute('data-sara-phase');
    const text = document.body.innerText;
    return {
      phase,
      listening: text.includes('Sara is listening'),
      reply: text.includes('Sip water through the day'),
      starts: window.__saraAudio?.starts?.length || 0,
      resumes: window.__saraAudio?.resumes || 0,
      button: document.querySelector('button[type="submit"]')?.textContent || '',
    };
  })()`)
  assert(listening.listening, 'listening copy is on screen while /ask is still running')
  assert(!listening.reply, 'the reply is not shown before /ask returns')
  assert(listening.phase === 'listening', 'portrait phase is listening during the round trip')
  assert(/Sara is listening/.test(listening.button), 'the send button says Sara is listening')
  assert(listening.starts >= 1, 'a silent buffer starts inside the Send tap, before /ask returns')
  assert(listening.resumes >= 1, 'AudioContext.resume runs inside the Send tap')
  assert(traffic.askDone === 0, '/ask has not returned yet, so playback was not waiting on the reply')
  mkdirSync(ARTIFACTS, { recursive: true })
  await shot(send, join(ARTIFACTS, 'sara-listening.png'))

  const textShown = await waitFor(
    evaluate,
    `document.body.innerText.includes('Sip water through the day')`,
    4000,
  )
  assert(textShown, 'reply text shows when /ask returns')
  const earlySpeak = traffic.speaks.map((row) => ({ ...row }))
  assert(earlySpeak.length >= 1, 'sentence 1 /speak starts as soon as the reply exists')
  assert(earlySpeak.every((row) => row.doneAt === 0), 'text is visible before TTS bytes return')

  const speaking = await waitFor(
    evaluate,
    `document.querySelector('[data-sara-phase]')?.getAttribute('data-sara-phase') === 'speaking'`,
    4000,
  )
  assert(speaking, 'portrait phase switches to speaking when audio is scheduled')
  await sleep(400)
  const heard = await evaluate(`(() => {
    const root = document.querySelector('[data-sara-phase]');
    const level = Number(getComputedStyle(root).getPropertyValue('--sara-level') || 0);
    return {
      level,
      starts: window.__saraAudio.starts.slice(),
      text: document.body.innerText.includes('Sip water through the day'),
      note: document.querySelector('.ask-sara-note')?.textContent || '',
    };
  })()`)
  assert(heard.text, 'the reply stays on screen while she speaks')
  assert(!/couldn't reach my voice/i.test(heard.note), 'playback is not blocked after the async /ask')
  assert(heard.level > 0.05, 'analyser level drives the glow while the tone plays')
  const speechWhens = heard.starts.filter((when) => when > 0.2)
  assert(speechWhens.length === 3, 'three sentence buffers are scheduled')
  const gaps = speechWhens.slice(1).map((when, i) => when - speechWhens[i])
  assert(gaps.every((gap) => gap > 0.25 && gap < 0.55), `chunks are queued gaplessly (${gaps.map((n) => n.toFixed(3)).join(', ')})`)
  await shot(send, join(ARTIFACTS, 'sara-speaking.png'))

  assert(traffic.speaks.length === 3, 'one /speak per chunk, not one per extra sentence past the cap')
  assert(traffic.speaks[0].text === 'Sip water through the day.', 'first /speak is sentence 1 only')
  assert(traffic.speaks[1].text === 'A glass with meals is plenty.', 'second sentence is its own /speak')
  assert(traffic.speaks[2].text === 'Log what you notice.', 'third sentence is its own /speak')
  assert(traffic.speaks.every((row) => row.pass === 'DEMO-SARA-001'), 'demo /speak sends the demo pass')
  const span = Math.max(...traffic.speaks.map((row) => row.at)) - Math.min(...traffic.speaks.map((row) => row.at))
  assert(span < 250, `later sentences are fetched in parallel (${span}ms)`)
  const firstDone = Math.min(...traffic.speaks.map((row) => row.doneAt))
  const lastRequest = Math.max(...traffic.speaks.map((row) => row.at))
  assert(firstDone > lastRequest, 'all /speak requests are in flight before the first response')
  assert(!traffic.paths.some((path) => path.includes('/stream') || path.includes('/talk')), 'demo path does not open a D-ID session')

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await send('Page.reload', { ignoreCache: true })
  const faceReady = await waitFor(evaluate, `Boolean(document.querySelector('.sara-portrait-face'))`, 3000)
  assert(faceReady, 'portrait is back after the reduced-motion reload')
  const reduced = await evaluate(`(() => {
    const face = document.querySelector('.sara-portrait-face');
    const probe = document.createElement('span');
    probe.className = 'sara-listening-dots';
    const dot = document.createElement('span');
    probe.appendChild(dot);
    document.body.appendChild(probe);
    const faceAnim = getComputedStyle(face).animationName;
    const dotAnim = getComputedStyle(dot).animationName;
    probe.remove();
    return { faceAnim, dotAnim };
  })()`)
  assert(reduced.faceAnim === 'none', `reduced motion stops the portrait sway (${reduced.faceAnim})`)
  assert(reduced.dotAnim === 'none', `reduced motion stops the listening dots (${reduced.dotAnim})`)

  if (process.exitCode) throw new Error('voice-ui checks failed')
  console.log('voice-ui smoke passed')
} finally {
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill('SIGKILL')
  server.close()
  await sleep(300)
  await rm(userData, { recursive: true, force: true }).catch(() => {})
}

if (process.exitCode) process.exit(process.exitCode)

async function waitFor(evaluate, expression, timeout = 2000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await evaluate(`Boolean(${expression})`)
    if (value) return true
    await sleep(40)
  }
  return false
}

async function shot(send, file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(data, 'base64'))
  assert(statSync(file).size > 10_000, `screenshot ${file} is a real frame`)
}
