/** Optional D-ID talking-head from the locked Sara still. Never import from the Vite app. */

export const DID_TALKS_URL = 'https://api.d-id.com/talks'
export const DID_AUDIOS_URL = 'https://api.d-id.com/audios'
export const SARA_STILL_URL =
  'https://sara-pfilates-coach.surge.sh/avatar/sara-default.png'

function didAuth(apiKey) {
  const raw = String(apiKey || '').trim()
  if (!raw) return ''
  if (/^basic\s+/i.test(raw)) return raw
  const token = raw.includes(':') ? raw : `${raw}:`
  return `Basic ${btoa(token)}`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function uploadDidAudio(audio, contentType, apiKey, fetchFn) {
  const type = contentType || 'audio/mpeg'
  const blob = new Blob([audio], { type })
  const form = new FormData()
  form.append('audio', blob, type.includes('wav') ? 'sara.wav' : 'sara.mp3')

  const res = await fetchFn(DID_AUDIOS_URL, {
    method: 'POST',
    headers: { Authorization: didAuth(apiKey) },
    body: form,
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => ({}))
  return data.url || data.audio_url || null
}

async function pollTalk(id, apiKey, fetchFn, maxMs = 45_000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    await sleep(1200)
    const res = await fetchFn(`${DID_TALKS_URL}/${id}`, {
      headers: { Authorization: didAuth(apiKey) },
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({}))
    if (data.status === 'done' && (data.result_url || data.audio_url)) {
      return data.result_url
    }
    if (data.status === 'error' || data.status === 'rejected') return null
  }
  return null
}

export async function talkSaraDid({
  audio,
  contentType = 'audio/mpeg',
  apiKey,
  imageUrl,
  fetchFn = fetch,
} = {}) {
  const still =
    imageUrl ||
    (typeof process !== 'undefined' && process.env?.SARA_AVATAR_URL) ||
    SARA_STILL_URL
  if (!apiKey) {
    return { ok: false, reason: 'missing_did_key' }
  }
  if (!audio || !audio.byteLength) {
    return { ok: false, reason: 'no_audio' }
  }

  let audioUrl
  try {
    audioUrl = await uploadDidAudio(audio, contentType, apiKey, fetchFn)
  } catch {
    return { ok: false, reason: 'did_upload_failed' }
  }
  if (!audioUrl) {
    return { ok: false, reason: 'did_upload_failed' }
  }

  let created
  try {
    const res = await fetchFn(DID_TALKS_URL, {
      method: 'POST',
      headers: {
        Authorization: didAuth(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: still,
        script: { type: 'audio', audio_url: audioUrl },
        config: { stitch: true, result_format: 'mp4' },
      }),
    })
    created = await res.json().catch(() => ({}))
    if (!res.ok || !created.id) {
      return { ok: false, reason: 'did_create_failed' }
    }
  } catch {
    return { ok: false, reason: 'did_create_failed' }
  }

  if (created.result_url) {
    return { ok: true, videoUrl: created.result_url }
  }

  let videoUrl
  try {
    videoUrl = await pollTalk(created.id, apiKey, fetchFn)
  } catch {
    return { ok: false, reason: 'did_poll_failed' }
  }
  if (!videoUrl) {
    return { ok: false, reason: 'did_timeout' }
  }
  return { ok: true, videoUrl }
}
