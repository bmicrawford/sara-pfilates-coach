/** D-ID Agents Streams credentials. Never import from the Vite app. */

import { didAuth, saraStillUrl, SARA_STILL_URL } from './talkSara.mjs'

export const DID_AGENTS_URL = 'https://api.d-id.com/agents'
export const STREAM_TTL_SECONDS = 600

/** Origins the minted client key may be used from. Keep in sync with CORS. */
export const STREAM_ALLOWED_DOMAINS = [
  'https://sara-pfilates.surge.sh',
  'https://sara-pfilates-coach.surge.sh',
  'http://localhost:43147',
  'http://127.0.0.1:43147',
]

export function saraAgentCreateBody(imageUrl) {
  const still = saraStillUrl(imageUrl)
  return {
    preview_name: 'Sara',
    preview_description: 'PfilAtes peer coach. Answers come from our Grok worker, not D-ID.',
    embed: true,
    presenter: {
      type: 'talk',
      source_url: still,
      thumbnail: still,
      stitch: true,
    },
  }
}

export function streamStartResponse(minted) {
  if (!minted?.ok) {
    return {
      agentId: null,
      clientKey: null,
      expiresAt: null,
      reason: minted?.reason || 'stream_failed',
    }
  }
  return {
    agentId: minted.agentId,
    clientKey: minted.clientKey,
    expiresAt: minted.expiresAt || null,
  }
}

let cached = null

export function resetStreamKeyCache() {
  cached = null
}

/**
 * Mint a short-lived Agents SDK client key. DID_API_KEY never leaves the server.
 * Reuses a cached key until ~30s before expiry (per isolate).
 */
export async function mintSaraStreamKey({
  apiKey,
  agentId,
  fetchFn = fetch,
  now = Date.now,
  ttlSeconds = STREAM_TTL_SECONDS,
} = {}) {
  const key = String(apiKey || '').trim()
  const id = String(agentId || '').trim()
  if (!key) {
    return { ok: false, agentId: null, clientKey: null, reason: 'missing_did_key' }
  }
  if (!id) {
    return { ok: false, agentId: null, clientKey: null, reason: 'missing_agent_id' }
  }

  const t = now()
  if (
    cached &&
    cached.agentId === id &&
    cached.clientKey &&
    cached.expiresAt &&
    cached.expiresAt - t > 30_000
  ) {
    return { ok: true, agentId: id, clientKey: cached.clientKey, expiresAt: cached.expiresAt }
  }

  const ttl = Math.min(86_400, Math.max(60, Number(ttlSeconds) || STREAM_TTL_SECONDS))
  let res
  try {
    res = await fetchFn(`${DID_AGENTS_URL}/${encodeURIComponent(id)}/client-keys`, {
      method: 'POST',
      headers: {
        Authorization: didAuth(key),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'sara-ask',
        allowed_domains: STREAM_ALLOWED_DOMAINS,
        ttl_seconds: ttl,
      }),
    })
  } catch {
    return { ok: false, agentId: id, clientKey: null, reason: 'did_stream_failed' }
  }

  const data = await res.json().catch(() => ({}))
  const clientKey = data.client_key || data.clientKey || null
  if (!res.ok || !clientKey) {
    return { ok: false, agentId: id, clientKey: null, reason: 'did_stream_failed' }
  }

  const expiresAt = data.expires_at ? Date.parse(data.expires_at) : t + ttl * 1000
  cached = { agentId: id, clientKey, expiresAt }
  return { ok: true, agentId: id, clientKey, expiresAt }
}

export { SARA_STILL_URL }
