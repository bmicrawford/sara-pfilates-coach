/** Shared Ask Sara → xAI neural TTS. Never import this from the Vite app. */

import { rewritePfilatesForSpeech } from '../src/lib/pfilatesSpeech.mjs'

export const XAI_TTS_URL = 'https://api.x.ai/v1/tts'
export const SARA_VOICE = 'ara'
export const SARA_VOICE_OFFLINE =
  "Sara’s voice isn’t connected on this API yet. Same XAI_API_KEY as Grok — pull main and restart the proxy."

const MAX_CHARS = 4000

export function clipSpeakText(text, max = MAX_CHARS) {
  return rewritePfilatesForSpeech(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, max)
}

export async function speakSaraTts({
  text,
  apiKey,
  voice = SARA_VOICE,
  fetchFn = fetch,
} = {}) {
  const clipped = clipSpeakText(text)
  if (!clipped) {
    return { ok: false, status: 400, error: 'empty' }
  }
  if (!apiKey) {
    return { ok: false, status: 503, error: 'no_key' }
  }

  let res
  try {
    res = await fetchFn(XAI_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        text: clipped,
        voice_id: voice,
        language: 'en',
      }),
    })
  } catch {
    return { ok: false, status: 503, error: 'network' }
  }

  if (!res.ok) {
    return { ok: false, status: 503, error: 'tts_failed' }
  }

  let bytes
  try {
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    return { ok: false, status: 503, error: 'bad_audio' }
  }
  if (!bytes.byteLength) {
    return { ok: false, status: 503, error: 'empty_audio' }
  }

  const headerType = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : ''
  const contentType = headerType && !headerType.includes('json') ? headerType : 'audio/mpeg'
  return { ok: true, status: 200, audio: bytes, contentType }
}
