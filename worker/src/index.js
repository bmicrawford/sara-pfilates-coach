import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL } from '../../server/askGrok.mjs'
import { speakSaraTts, SARA_VOICE } from '../../server/speakSara.mjs'
import { talkSaraDid } from '../../server/talkSara.mjs'

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
        },
        origin,
      )
      return new Response(out.body, { status: out.status, headers: out.headers })
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
        const out = jsonResponse(200, { videoUrl: null, reason: 'missing_did_key' }, origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }
      const spoken = await speakSaraTts({
        text: body.text ?? body.message,
        apiKey: env.XAI_API_KEY,
        voice: env.XAI_TTS_VOICE || SARA_VOICE,
      })
      if (!spoken.ok) {
        const out = jsonResponse(200, { videoUrl: null, reason: spoken.error }, origin)
        return new Response(out.body, { status: out.status, headers: out.headers })
      }
      const talked = await talkSaraDid({
        audio: spoken.audio,
        contentType: spoken.contentType,
        apiKey: env.DID_API_KEY,
        imageUrl: env.SARA_AVATAR_URL,
      })
      const out = jsonResponse(
        200,
        { videoUrl: talked.ok ? talked.videoUrl : null, reason: talked.ok ? undefined : talked.reason },
        origin,
      )
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    const out = jsonResponse(404, { reply: 'Not found' }, origin)
    return new Response(out.body, { status: out.status, headers: out.headers })
  },
}
