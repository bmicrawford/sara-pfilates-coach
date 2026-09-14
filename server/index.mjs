import { createServer } from 'node:http'
import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL } from './askGrok.mjs'

const PORT = Number(process.env.SARA_API_PORT || 8787)

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 80_000) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res, result, origin) {
  const out = jsonResponse(result.status, { reply: result.reply }, origin)
  res.writeHead(out.status, out.headers)
  res.end(out.body)
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || ''
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders(origin) })
    res.end(JSON.stringify({ ok: true, model: process.env.XAI_MODEL || GROK_MODEL }))
    return
  }

  if (req.method !== 'POST' || url.pathname !== '/ask') {
    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders(origin) })
    res.end(JSON.stringify({ reply: 'Not found' }))
    return
  }

  try {
    const raw = await readBody(req)
    const body = raw ? JSON.parse(raw) : {}
    const result = await askSaraGrok({
      message: body.message ?? body.text,
      history: body.history,
      apiKey: process.env.XAI_API_KEY,
      model: process.env.XAI_MODEL || GROK_MODEL,
    })
    send(res, result, origin)
  } catch {
    send(res, { status: 503, reply: "I couldn't reach my brain just now — try again in a moment." }, origin)
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sara Ask API on http://127.0.0.1:${PORT}  model=${process.env.XAI_MODEL || GROK_MODEL}`)
})
