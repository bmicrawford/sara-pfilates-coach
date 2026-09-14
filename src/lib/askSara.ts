import type { ChatMessage } from './types'

export const SARA_OFFLINE =
  "I couldn't reach my brain just now — try again in a moment."

function apiUrl(): string {
  const base = (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
  return `${base}/ask`
}

export async function askSaraRemote(
  message: string,
  history: ChatMessage[],
): Promise<string> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 45_000)
  try {
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        message,
        history: history.slice(-12).map((m) => ({ from: m.from, text: m.text })),
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { reply?: string }
    const reply = data.reply?.trim()
    if (!res.ok || !reply) return SARA_OFFLINE
    return reply
  } catch {
    return SARA_OFFLINE
  } finally {
    window.clearTimeout(timer)
  }
}
