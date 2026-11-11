export const SARA_BUSY_MESSAGE = 'Sara is busy, please try again in a bit.'
export const SARA_UNKNOWN_PASS_MESSAGE = "That pass isn't recognized."
export const SARA_PASS_REQUIRED_MESSAGE = 'Open your Sara link again, then ask.'

type GateBody = {
  message?: string
  reply?: string
  error?: string
}

export function messageForSaraStatus(status: number, data: GateBody | null | undefined): string | null {
  const body = data ?? {}
  const text = body.message?.trim() || body.reply?.trim() || ''
  if (body.error === 'did_unavailable') return null
  if (status === 429) return text || SARA_BUSY_MESSAGE
  if (status === 401) return text || SARA_PASS_REQUIRED_MESSAGE
  if (status === 403 && body.error === 'demo_voice_only') return null
  if (status === 403) return text || SARA_UNKNOWN_PASS_MESSAGE
  return null
}

export function isSaraBusy(reply: string): boolean {
  return reply.trim().toLowerCase() === SARA_BUSY_MESSAGE.toLowerCase()
}
