/** Shared guards for the durable Ask Sara origin. No secrets. */

export const TRYCLOUDFLARE =
  /(?:^https?:\/\/)?[^/]*\.trycloudflare\.com(?:[:/?#]|$)/i

export const EXPECTED_TTS = 'ara'

export function normalizeSaraApiUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/$/, '')
}

export function isEphemeralTunnel(url) {
  return TRYCLOUDFLARE.test(String(url ?? '').trim())
}

/**
 * Phone demo must not bake a trycloudflare tunnel.
 * Empty is allowed for local Vite (proxies /ask /speak to 127.0.0.1:8787).
 */
export function assertDurableSaraApiUrl(url, { requirePresent = false } = {}) {
  const normalized = normalizeSaraApiUrl(url)
  if (!normalized) {
    if (requirePresent) {
      throw new Error(
        'Missing Ask Sara origin. Pass the Worker URL: npm run verify:ask-api -- https://sara-pfilates-ask.<account>.workers.dev',
      )
    }
    return normalized
  }
  if (isEphemeralTunnel(normalized)) {
    throw new Error(
      `VITE_SARA_API_URL is an ephemeral trycloudflare tunnel (${normalized}). ` +
        'Use the durable Cloudflare Worker (https://sara-pfilates-ask.<account>.workers.dev) and rebuild Surge. ' +
        'Do not bake *.trycloudflare.com into the phone demo.',
    )
  }
  return normalized
}

export function ttsIsAra(tts) {
  return String(tts ?? '').trim().toLowerCase() === EXPECTED_TTS
}

export function surgeRebuildReminder(workerUrl) {
  const origin = workerUrl || 'https://sara-pfilates-ask.<account>.workers.dev'
  return [
    'After wrangler deploy (human; XAI_API_KEY already in Worker secrets):',
    `  VITE_SARA_API_URL=${origin} npm run build`,
    '  npx surge ./dist https://sara-pfilates.surge.sh',
    `  npm run verify:ask-api -- ${origin}`,
    'Never bake *.trycloudflare.com into the phone demo. D-ID stays paused (no DID_API_KEY).',
  ].join('\n')
}
