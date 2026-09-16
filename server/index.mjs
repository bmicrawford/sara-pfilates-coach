import { createServer } from 'node:http'
import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL, SARA_OFFLINE } from './askGrok.mjs'
import { speakSaraTts, SARA_VOICE } from './speakSara.mjs'
import {
  talkSaraDid,
  getSaraTalk,
  isTalkPath,
  talkIdFromUrl,
  talkStartResponse,
  talkPollResponse,
} from './talkSara.mjs'
import { mintSaraStreamKey, streamStartResponse } from './streamSara.mjs'

const PORT = Number(process.env.SARA_API_PORT || 8787)

function readBody(req, max = 80_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > max) {
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

function sendJson(res, result, origin) {
  const out = jsonResponse(result.status, result.body, origin)
  res.writeHead(out.status, out.headers)
  res.end(out.body)
}

function sendTalkJson(res, body, origin) {
  const out = jsonResponse(200, body, origin)
  res.writeHead(out.status, { ...out.headers, 'Cache-Control': 'no-store' })
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
    res.end(
      JSON.stringify({
        ok: true,
        model: process.env.XAI_MODEL || GROK_MODEL,
        tts: process.env.XAI_TTS_VOICE || SARA_VOICE,
        talk: Boolean(process.env.DID_API_KEY),
        stream: Boolean(process.env.DID_API_KEY && process.env.DID_AGENT_ID),
      }),
    )
    return
  }

  if (req.method === 'POST' && url.pathname === '/ask') {
    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const result = await askSaraGrok({
        message: body.message ?? body.text,
        history: body.history,
        apiKey: process.env.XAI_API_KEY,
        model: process.env.XAI_MODEL || GROK_MODEL,
      })
      sendJson(res, { status: result.status, body: { reply: result.reply } }, origin)
    } catch {
      sendJson(
        res,
        { status: 503, body: { reply: SARA_OFFLINE } },
        origin,
      )
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/speak') {
    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const result = await speakSaraTts({
        text: body.text ?? body.message,
        apiKey: process.env.XAI_API_KEY,
        voice: process.env.XAI_TTS_VOICE || SARA_VOICE,
      })
      if (!result.ok) {
        sendJson(res, { status: result.status, body: { error: result.error, voice: 'unavailable' } }, origin)
        return
      }
      res.writeHead(200, {
        'Content-Type': result.contentType,
        'Cache-Control': 'no-store',
        ...corsHeaders(origin),
      })
      res.end(Buffer.from(result.audio))
    } catch {
      sendJson(res, { status: 503, body: { error: 'tts_failed', voice: 'unavailable' } }, origin)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/stream') {
    try {
      const minted = await mintSaraStreamKey({
        apiKey: process.env.DID_API_KEY,
        agentId: process.env.DID_AGENT_ID,
      })
      sendTalkJson(res, streamStartResponse(minted), origin)
    } catch {
      sendTalkJson(res, streamStartResponse({ ok: false, reason: 'stream_failed' }), origin)
    }
    return
  }

  if (req.method === 'GET' && isTalkPath(url.pathname)) {
    const talked = await getSaraTalk({
      id: talkIdFromUrl(url),
      apiKey: process.env.DID_API_KEY,
    })
    sendTalkJson(res, talkPollResponse(talked), origin)
    return
  }

  if (req.method === 'POST' && url.pathname === '/talk') {
    if (!process.env.DID_API_KEY) {
      sendTalkJson(res, talkStartResponse({ ok: false, reason: 'missing_did_key' }), origin)
      return
    }
    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const spoken = await speakSaraTts({
        text: body.text ?? body.message,
        apiKey: process.env.XAI_API_KEY,
        voice: process.env.XAI_TTS_VOICE || SARA_VOICE,
      })
      if (!spoken.ok) {
        sendTalkJson(res, talkStartResponse({ ok: false, reason: spoken.error }), origin)
        return
      }
      const talked = await talkSaraDid({
        audio: spoken.audio,
        contentType: spoken.contentType,
        apiKey: process.env.DID_API_KEY,
        imageUrl: process.env.SARA_AVATAR_URL,
      })
      sendTalkJson(res, talkStartResponse(talked), origin)
    } catch {
      sendTalkJson(res, talkStartResponse({ ok: false, reason: 'talk_failed' }), origin)
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders(origin) })
  res.end(JSON.stringify({ reply: 'Not found' }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Sara Ask API on http://127.0.0.1:${PORT}  model=${process.env.XAI_MODEL || GROK_MODEL}  tts=${process.env.XAI_TTS_VOICE || SARA_VOICE}`,
  )
})
