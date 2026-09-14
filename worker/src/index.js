import { askSaraGrok, corsHeaders, jsonResponse, GROK_MODEL } from '../../server/askGrok.mjs'

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      const out = jsonResponse(200, { ok: true, model: env.XAI_MODEL || GROK_MODEL }, origin)
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    if (request.method !== 'POST' || url.pathname !== '/ask') {
      const out = jsonResponse(404, { reply: 'Not found' }, origin)
      return new Response(out.body, { status: out.status, headers: out.headers })
    }

    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const result = await askSaraGrok({
      message: body.message ?? body.text,
      history: body.history,
      apiKey: env.XAI_API_KEY,
      model: env.XAI_MODEL || GROK_MODEL,
    })
    const out = jsonResponse(result.status, { reply: result.reply }, origin)
    return new Response(out.body, { status: out.status, headers: out.headers })
  },
}
