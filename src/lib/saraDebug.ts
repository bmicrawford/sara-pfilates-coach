/** Survives the redeem redirect, which replaces /r/TOKEN?debug=1 with /. */
export const SARA_DEBUG_KEY = 'sara.debug'

export function captureSaraDebug(search = ''): void {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (params.get('debug') !== '1') return
  try {
    sessionStorage.setItem(SARA_DEBUG_KEY, '1')
  } catch {
    /* private mode */
  }
}

export function saraDebugOn(search = ''): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (params.get('debug') === '1') return true
  try {
    return sessionStorage.getItem(SARA_DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

/** Keep ?debug=1 on the next in-app URL when it was already requested. */
export function withSaraDebug(path: string): string {
  if (!saraDebugOn() || /(?:\?|&)debug=1(?:&|$)/.test(path)) return path
  return path.includes('?') ? `${path}&debug=1` : `${path}?debug=1`
}
