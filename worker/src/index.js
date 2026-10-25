import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL, SARA_OFFLINE } from '../../server/askGrok.mjs'
import { dispatchRedeem, headerGetter, kvRedeemStore } from '../../server/redeem.mjs'
import { speakSaraTts, SARA_VOICE } from '../../server/speakSara.mjs'
import {
  talkSaraDid,
  getSaraTalk,
  talkIdFromUrl,
  talkStartResponse,
  talkPollResponse,
} from '../../server/talkSara.mjs'
import { mintSaraStreamKey, streamStartResponse } from '../../server/streamSara.mjs'
import {
  authorizePaidRequest,
  clientIpFromHeaders,
  denialExtraHeaders,
  didUnavailableDecision,
  kvCounterStore,
  paidEndpoint,
  passFromParts,
} from '../../server/demoGate.mjs'

function talkJson(status, body, origin) {
  const out = jsonResponse(status, body, origin)
  return { ...out, headers: { ...out.headers, 'Cache-Control': 'no-store' } }
}

function respond(status, body, origin, extra = {}) {
  const out = jsonResponse(status, body, origin)
  return new Response(out.body, {
    status: out.status,
    headers: { ...out.headers, 'Cache-Control': 'no-store', ...extra },
  })
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      const out = jsonResponse(
        200,
        {
          ok: true,
          model: env.XAI_MODEL || GROK_MODEL,
          tts: env.XAI_TTS_VOICE || SARA_VOICE,
          talk: Boolean(env.DID_API_KEY),
          stream: Boolean(env.DID_API_KEY && env.DID_AGENT_ID),
          redeem: Boolean(env.REDEEM_MINT_SECRET && env.REDEEM_TOKENS),
        },
        origin,
      )
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    if (request.method === 'POST' && (url.pathname === '/redeem' || url.pathname === '/redeem/mint')) {
      let redeemBody = {}
      let jsonFailed = false
      try {
        const text = await request.text()
        if (text.trim()) {
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) redeemBody = parsed
          else jsonFailed = true
        }
      } catch {
        jsonFailed = true
      }
      if (jsonFailed) {
        const out = jsonResponse(400, { ok: false, error: 'invalid_json' }, origin)
        return new Response(out.body, {
          status: out.status,
          headers: { ...out.headers, 'Cache-Control': 'no-store' },
        })
      }
      try {
        const result = await dispatchRedeem(url.pathname, request.method, {
          store: kvRedeemStore(env.REDEEM_TOKENS),
          secret: String(env.REDEEM_MINT_SECRET || '').trim(),
          getHeader: headerGetter(request.headers),
          body: redeemBody,
          publicOrigin: env.SARA_PUBLIC_ORIGIN,
          now: new Date().toISOString(),
        })
        const out = jsonResponse(result.status, result.body, origin)
        return new Response(out.body, {
          status: out.status,
          headers: { ...out.headers, 'Cache-Control': 'no-store' },
        })
      } catch {
        const out = jsonResponse(503, { ok: false, error: 'redeem_failed' }, origin)
        return new Response(out.body, {
          status: out.status,
          headers: { ...out.headers, 'Cache-Control': 'no-store' },
        })
      }
    }

    const endpoint = paidEndpoint(request.method, url.pathname)
    if (endpoint) {
      let body = {}
      if (request.method === 'POST') {
        try {
          const parsed = await request.json()
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed
        } catch {
          body = {}
        }
      }
      let decision
      try {
        decision = await authorizePaidRequest({
          method: request.method,
          pathname: url.pathname,
          pass: passFromParts({
            body,
            header: request.headers.get('X-Sara-Pass'),
            query: url.searchParams.get('pass'),
          }),
          redeemStore: kvRedeemStore(env.REDEEM_TOKENS),
          counterStore: kvCounterStore(env.REDEEM_TOKENS),
          ip: clientIpFromHeaders(request.headers),
        })
      } catch {
        return respond(503, { ok: false, error: 'busy', message: SARA_OFFLINE, reply: SARA_OFFLINE }, origin)
      }
      if (!decision.allow) {
        return respond(decision.status, decision.body, origin, denialExtraHeaders(decision))
      }

      if (endpoint === 'ask') {
        const result = await askSaraGrok({
          message: body.message ?? body.text,
          history: body.history,
          firstTurn: body.firstTurn,
          apiKey: env.XAI_API_KEY,
          model: env.XAI_MODEL || GROK_MODEL,
          audience: decision.pass.voiceOnly ? 'demo' : undefined,
        })
        const out = jsonResponse(result.status, { reply: result.reply }, origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }

      if (endpoint === 'speak') {
        const result = await speakSaraTts({
          text: body.text ?? body.message,
          apiKey: env.XAI_API_KEY,
          voice: env.XAI_TTS_VOICE || SARA_VOICE,
        })
        if (!result.ok) {
          const out = jsonResponse(result.status, { error: result.error, voice: 'unavailable' }, origin)
          return new Response(out.body, { status: out.status, headers: out.headers })
        }
        return new Response(result.audio, {
          status: 200,
          headers: {
            'Content-Type': result.contentType,
            'Cache-Control': 'no-store',
            ...corsHeaders(origin),
          },
        })
      }

      if (endpoint === 'stream') {
        try {
          const minted = await mintSaraStreamKey({
            apiKey: env.DID_API_KEY,
            agentId: env.DID_AGENT_ID,
          })
          if (minted.capacity) {
            const denied = didUnavailableDecision()
            return respond(denied.status, denied.body, origin, denialExtraHeaders(denied))
          }
          const out = talkJson(200, streamStartResponse(minted), origin)
          return new Response(out.body, { status: out.status, headers: out.headers })
        } catch {
          const out = talkJson(200, streamStartResponse({ ok: false, reason: 'stream_failed' }), origin)
          return new Response(out.body, { status: out.status, headers: out.headers })
        }
      }

      if (request.method === 'GET') {
        const talked = await getSaraTalk({
          id: talkIdFromUrl(url),
          apiKey: env.DID_API_KEY,
        })
        const out = talkJson(200, talkPollResponse(talked), origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }

      if (!env.DID_API_KEY) {
        const out = talkJson(200, talkStartResponse({ ok: false, reason: 'missing_did_key' }), origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }
      const spoken = await speakSaraTts({
        text: body.text ?? body.message,
        apiKey: env.XAI_API_KEY,
        voice: env.XAI_TTS_VOICE || SARA_VOICE,
      })
      if (!spoken.ok) {
        const out = talkJson(200, talkStartResponse({ ok: false, reason: spoken.error }), origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }
      const talked = await talkSaraDid({
        audio: spoken.audio,
        contentType: spoken.contentType,
        apiKey: env.DID_API_KEY,
        imageUrl: env.SARA_AVATAR_URL,
      })
      if (talked.capacity) {
        const denied = didUnavailableDecision()
        return respond(denied.status, denied.body, origin, denialExtraHeaders(denied))
      }
      const out = talkJson(200, talkStartResponse(talked), origin)
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    const out = jsonResponse(404, { reply: 'Not found' }, origin)
    return new Response(out.body, { status: out.status, headers: out.headers })
  },
}
