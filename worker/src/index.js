import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL } from '../../server/askGrok.mjs'
import { dispatchRedeem, headerGetter, kvRedeemStore } from '../../server/redeem.mjs'
import { speakSaraTts, SARA_VOICE } from '../../server/speakSara.mjs'
import {
  talkSaraDid,
  getSaraTalk,
  isTalkPath,
  talkIdFromUrl,
  talkStartResponse,
  talkPollResponse,
} from '../../server/talkSara.mjs'
import { mintSaraStreamKey, streamStartResponse } from '../../server/streamSara.mjs'

function talkJson(status, body, origin) {
  const out = jsonResponse(status, body, origin)
  return { ...out, headers: { ...out.headers, 'Cache-Control': 'no-store' } }
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

    if (request.method === 'GET' && isTalkPath(url.pathname)) {
      const talked = await getSaraTalk({
        id: talkIdFromUrl(url),
        apiKey: env.DID_API_KEY,
      })
      const out = talkJson(200, talkPollResponse(talked), origin)
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    if (request.method === 'POST' && url.pathname === '/stream') {
      try {
        const minted = await mintSaraStreamKey({
          apiKey: env.DID_API_KEY,
          agentId: env.DID_AGENT_ID,
        })
        const out = talkJson(200, streamStartResponse(minted), origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      } catch {
        const out = talkJson(200, streamStartResponse({ ok: false, reason: 'stream_failed' }), origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }
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

    let body = {}
    if (request.method === 'POST') {
      try {
        body = await request.json()
      } catch {
        body = {}
      }
    }

    if (request.method === 'POST' && url.pathname === '/ask') {
      const result = await askSaraGrok({
        message: body.message ?? body.text,
        history: body.history,
        apiKey: env.XAI_API_KEY,
        model: env.XAI_MODEL || GROK_MODEL,
      })
      const out = jsonResponse(result.status, { reply: result.reply }, origin)
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    if (request.method === 'POST' && url.pathname === '/speak') {
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

    if (request.method === 'POST' && url.pathname === '/talk') {
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
      const out = talkJson(200, talkStartResponse(talked), origin)
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    const out = jsonResponse(404, { reply: 'Not found' }, origin)
    return new Response(out.body, { status: out.status, headers: out.headers })
  },
}
