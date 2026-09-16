/** Optional D-ID talking-head from the locked Sara still. Never import from the Vite app. */

export const DID_TALKS_URL = 'https://api.d-id.com/talks'
export const DID_AUDIOS_URL = 'https://api.d-id.com/audios'
export const SARA_STILL_URL = 'https://sara-pfilates.surge.sh/avatar/sara-default.png'

export function didAuth(apiKey) {
  const raw = String(apiKey || '').trim()
  if (!raw) return ''
  if (/^basic\s+/i.test(raw)) return raw
  const token = raw.includes(':') ? raw : `${raw}:`
  return `Basic ${btoa(token)}`
}

export function saraStillUrl(imageUrl) {
  return (
    imageUrl ||
    (typeof process !== 'undefined' && process.env?.SARA_AVATAR_URL) ||
    SARA_STILL_URL
  )
}

export function isTalkPath(pathname) {
  const path = String(pathname || '')
  return path === '/talk' || /^\/talk\/[^/]+\/?$/.test(path)
}

export function talkIdFromUrl(url) {
  const q = String(url?.searchParams?.get('id') || '').trim()
  if (q) return q
  const m = String(url?.pathname || '').match(/^\/talk\/([^/]+)\/?$/)
  return m ? decodeURIComponent(m[1]).trim() : ''
}

export function talkStartResponse(talked) {
  if (!talked?.ok) {
    return { talkId: null, videoUrl: null, reason: talked?.reason || 'talk_failed' }
  }
  return { talkId: talked.talkId || null, videoUrl: talked.videoUrl || null }
}

export function talkPollResponse(got) {
  return {
    status: got?.status || 'error',
    videoUrl: got?.videoUrl || null,
    reason: got?.reason,
  }
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

/** Start a D-ID talk. Returns talkId quickly; does not wait for the mp4. */
export async function talkSaraDid({
  audio,
  contentType = 'audio/mpeg',
  apiKey,
  imageUrl,
  fetchFn = fetch,
} = {}) {
  const still = saraStillUrl(imageUrl)
  if (!apiKey) {
    return { ok: false, talkId: null, videoUrl: null, reason: 'missing_did_key' }
  }
  if (!audio || !audio.byteLength) {
    return { ok: false, talkId: null, videoUrl: null, reason: 'no_audio' }
  }

  let audioUrl
  try {
    audioUrl = await uploadDidAudio(audio, contentType, apiKey, fetchFn)
  } catch {
    return { ok: false, talkId: null, videoUrl: null, reason: 'did_upload_failed' }
  }
  if (!audioUrl) {
    return { ok: false, talkId: null, videoUrl: null, reason: 'did_upload_failed' }
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
      return { ok: false, talkId: null, videoUrl: null, reason: 'did_create_failed' }
    }
  } catch {
    return { ok: false, talkId: null, videoUrl: null, reason: 'did_create_failed' }
  }

  return {
    ok: true,
    talkId: created.id,
    videoUrl: created.result_url || null,
  }
}

/** One D-ID GET for a talk id. Call again from the client until videoUrl or timeout. */
export async function getSaraTalk({ id, apiKey, fetchFn = fetch } = {}) {
  if (!apiKey) {
    return { ok: false, status: 'error', videoUrl: null, reason: 'missing_did_key' }
  }
  const talkId = String(id || '').trim()
  if (!talkId) {
    return { ok: false, status: 'error', videoUrl: null, reason: 'missing_id' }
  }

  try {
    const res = await fetchFn(`${DID_TALKS_URL}/${encodeURIComponent(talkId)}`, {
      headers: { Authorization: didAuth(apiKey) },
    })
    if (!res.ok) {
      return { ok: false, status: 'error', videoUrl: null, reason: 'did_poll_failed' }
    }
    const data = await res.json().catch(() => ({}))
    const status = String(data.status || 'unknown')
    if (status === 'done') {
      const videoUrl = data.result_url || null
      if (videoUrl) return { ok: true, status: 'done', videoUrl }
      return { ok: false, status: 'error', videoUrl: null, reason: 'did_no_result' }
    }
    if (status === 'error' || status === 'rejected') {
      return { ok: false, status, videoUrl: null, reason: 'did_error' }
    }
    return { ok: true, status, videoUrl: null }
  } catch {
    return { ok: false, status: 'error', videoUrl: null, reason: 'did_poll_failed' }
  }
}
