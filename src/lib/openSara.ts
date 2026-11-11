/**
 * Welcome-email entry. Kajabi's {{ email }} merge tag is not always URL-encoded,
 * so a plus in the address can arrive as a space. Put the plus back before lookup.
 */

export function openEmailFromSearch(search: string): string {
  const text = String(search ?? '')
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : text.replace(/^\?/, '')
  const params = new URLSearchParams(query)
  const raw = params.get('e') ?? params.get('email') ?? ''
  return raw.trim().replace(/ /g, '+')
}

export const SARA_OPEN_WAITING = 'We’re getting Sara ready. Try again in a minute'

type OpenReady = { ready: true; token: string; email: string }
type OpenWaiting = { ready: false }

function saraApiBase(): string {
  return String(import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
}

/** Same answer for a miss, a late webhook, a rate limit, or a blip. The page does not explain which. */
export async function openSaraAccess(email: string): Promise<OpenReady | OpenWaiting> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`${saraApiBase()}/kajabi/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: ctrl.signal,
    })
    const data = (await res.json().catch(() => null)) as { ready?: boolean; token?: string; email?: string } | null
    if (!res.ok || !data || data.ready !== true || typeof data.token !== 'string' || typeof data.email !== 'string') {
      return { ready: false }
    }
    return { ready: true, token: data.token, email: data.email }
  } catch {
    return { ready: false }
  } finally {
    window.clearTimeout(timer)
  }
}
