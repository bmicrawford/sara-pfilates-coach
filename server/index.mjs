import { createServer } from 'node:http'
import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL, SARA_OFFLINE } from './askGrok.mjs'
import { speakSaraTts, SARA_VOICE } from './speakSara.mjs'
import {
  talkSaraDid,
  getSaraTalk,
  talkIdFromUrl,
  talkStartResponse,
  talkPollResponse,
} from './talkSara.mjs'
import { mintSaraStreamKey, streamStartResponse } from './streamSara.mjs'
import { dispatchRedeem, headerGetter } from './redeem.mjs'
import { createFileRedeemStore } from './redeemFileStore.mjs'
import {
  authorizePaidRequest,
  clientIpFromHeaders,
  denialExtraHeaders,
  didUnavailableDecision,
  memoryCounterStore,
  paidEndpoint,
  passFromParts,
} from './demoGate.mjs'

const redeemStore = createFileRedeemStore(new URL('./.redeem-store.json', import.meta.url))
const demoCounters = memoryCounterStore()

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

function sendJson(res, result, origin, extra = {}) {
  const out = jsonResponse(result.status, result.body, origin)
  res.writeHead(out.status, { ...out.headers, ...extra })
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
        redeem: Boolean(String(process.env.REDEEM_MINT_SECRET || '').trim() && redeemStore),
      }),
    )
    return
  }

  if (req.method === 'POST' && (url.pathname === '/redeem' || url.pathname === '/redeem/mint')) {
    let redeemBody = {}
    let jsonFailed = false
    try {
      const raw = await readBody(req)
      if (raw.trim()) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) redeemBody = parsed
        else jsonFailed = true
      }
    } catch {
      jsonFailed = true
    }
    if (jsonFailed) {
      const out = jsonResponse(400, { ok: false, error: 'invalid_json' }, origin)
      res.writeHead(out.status, { ...out.headers, 'Cache-Control': 'no-store' })
      res.end(out.body)
      return
    }
    try {
      const result = await dispatchRedeem(url.pathname, 'POST', {
        store: redeemStore,
        secret: String(process.env.REDEEM_MINT_SECRET || '').trim(),
        getHeader: headerGetter(req.headers),
        body: redeemBody,
        publicOrigin: process.env.SARA_PUBLIC_ORIGIN,
        now: new Date().toISOString(),
      })
      const out = jsonResponse(result.status, result.body, origin)
      res.writeHead(out.status, { ...out.headers, 'Cache-Control': 'no-store' })
      res.end(out.body)
    } catch {
      const out = jsonResponse(503, { ok: false, error: 'redeem_failed' }, origin)
      res.writeHead(out.status, { ...out.headers, 'Cache-Control': 'no-store' })
      res.end(out.body)
    }
    return
  }

  const endpoint = paidEndpoint(req.method, url.pathname)
  if (endpoint) {
    let body = {}
    if (req.method === 'POST') {
      try {
        const raw = await readBody(req)
        if (raw.trim()) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed
        }
      } catch {
        body = {}
      }
    }
    let decision
    try {
      decision = await authorizePaidRequest({
        method: req.method,
        pathname: url.pathname,
        pass: passFromParts({
          body,
          header: headerGetter(req.headers)('x-sara-pass'),
          query: url.searchParams.get('pass'),
        }),
        redeemStore,
        counterStore: demoCounters,
        ip: clientIpFromHeaders(req.headers, req.socket?.remoteAddress || 'unknown'),
      })
    } catch {
      sendJson(res, { status: 503, body: { reply: SARA_OFFLINE } }, origin)
      return
    }
    if (!decision.allow) {
      sendJson(
        res,
        { status: decision.status, body: decision.body },
        origin,
        { 'Cache-Control': 'no-store', ...denialExtraHeaders(decision) },
      )
      return
    }

    if (endpoint === 'ask') {
      try {
        const result = await askSaraGrok({
          message: body.message ?? body.text,
          history: body.history,
          firstTurn: body.firstTurn,
          apiKey: process.env.XAI_API_KEY,
          model: process.env.XAI_MODEL || GROK_MODEL,
          audience: decision.pass.voiceOnly ? 'demo' : undefined,
        })
        sendJson(res, { status: result.status, body: { reply: result.reply } }, origin)
      } catch {
        sendJson(res, { status: 503, body: { reply: SARA_OFFLINE } }, origin)
      }
      return
    }

    if (endpoint === 'speak') {
      try {
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

    if (endpoint === 'stream') {
      try {
        const minted = await mintSaraStreamKey({
          apiKey: process.env.DID_API_KEY,
          agentId: process.env.DID_AGENT_ID,
        })
        if (minted.capacity) {
          const denied = didUnavailableDecision()
          sendJson(
            res,
            { status: denied.status, body: denied.body },
            origin,
            { 'Cache-Control': 'no-store', ...denialExtraHeaders(denied) },
          )
          return
        }
        sendTalkJson(res, streamStartResponse(minted), origin)
      } catch {
        sendTalkJson(res, streamStartResponse({ ok: false, reason: 'stream_failed' }), origin)
      }
      return
    }

    if (req.method === 'GET') {
      const talked = await getSaraTalk({
        id: talkIdFromUrl(url),
        apiKey: process.env.DID_API_KEY,
      })
      sendTalkJson(res, talkPollResponse(talked), origin)
      return
    }

    if (!process.env.DID_API_KEY) {
      sendTalkJson(res, talkStartResponse({ ok: false, reason: 'missing_did_key' }), origin)
      return
    }
    try {
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
      if (talked.capacity) {
        const denied = didUnavailableDecision()
        sendJson(
          res,
          { status: denied.status, body: denied.body },
          origin,
          { 'Cache-Control': 'no-store', ...denialExtraHeaders(denied) },
        )
        return
      }
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
