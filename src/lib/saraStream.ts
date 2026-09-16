/** D-ID Agents SDK (WebRTC). Credentials come from POST /stream — never the server API key. */

function apiBase(): string {
  return (import.meta.env.VITE_SARA_API_URL ?? '').replace(/\/$/, '')
}

export type SaraStreamCreds = {
  agentId: string
  clientKey: string
  expiresAt?: number | null
}

type AgentManagerLike = {
  connect: () => Promise<unknown>
  disconnect: () => Promise<unknown>
  speak: (script: { type: 'text'; input: string }) => Promise<unknown>
  interrupt?: (arg?: unknown) => unknown
}

type StreamCallbacks = {
  onTalking?: (talking: boolean) => void
}

let videoEl: HTMLVideoElement | null = null
let srcObject: MediaStream | null = null
let manager: AgentManagerLike | null = null
let connectPromise: Promise<boolean> | null = null
let speakGen = 0
const listeners: StreamCallbacks = {}

function primeVideo(video: HTMLVideoElement) {
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.playsInline = true
  video.autoplay = true
  video.muted = true
}

function attachSrcObject(stream: MediaStream | null) {
  srcObject = stream
  if (!videoEl) return
  primeVideo(videoEl)
  videoEl.srcObject = stream
  videoEl.muted = true
  if (stream) void videoEl.play().catch(() => {})
}

export function bindSaraStreamVideo(el: HTMLVideoElement | null) {
  videoEl = el
  if (el) attachSrcObject(srcObject)
}

export function setSaraStreamCallbacks(next: StreamCallbacks) {
  listeners.onTalking = next.onTalking
}

export async function fetchSaraStreamCreds(): Promise<SaraStreamCreds | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`${apiBase()}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: '{}',
    })
    const data = (await res.json().catch(() => ({}))) as {
      agentId?: string | null
      clientKey?: string | null
      expiresAt?: number | null
    }
    if (!data.agentId || !data.clientKey) return null
    return { agentId: data.agentId, clientKey: data.clientKey, expiresAt: data.expiresAt }
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

async function loadSdk() {
  const mod = (await import('@d-id/client-sdk')) as {
    createAgentManager?: (id: string, opts: unknown) => Promise<AgentManagerLike>
    default?: { createAgentManager?: (id: string, opts: unknown) => Promise<AgentManagerLike> }
  }
  return mod.createAgentManager || mod.default?.createAgentManager || null
}

export async function connectSaraStream(): Promise<boolean> {
  if (manager) return true
  if (connectPromise) return connectPromise
  connectPromise = (async () => {
    const creds = await fetchSaraStreamCreds()
    if (!creds) return false
    const create = await loadSdk()
    if (!create) return false
    const created = await create(creds.agentId, {
      auth: { type: 'key', clientKey: creds.clientKey },
      enableAnalytics: false,
      streamOptions: { compatibilityMode: 'auto', streamWarmup: true },
      callbacks: {
        onSrcObjectReady(value: MediaStream) {
          attachSrcObject(value)
          return value
        },
        onVideoStateChange(state: string) {
          listeners.onTalking?.(String(state).toUpperCase() !== 'STOP')
        },
        onConnectionStateChange() {},
        onError() {},
      },
    })
    manager = created
    await created.connect()
    return true
  })().catch(() => false)
  const ok = await connectPromise
  if (!ok) {
    connectPromise = null
    manager = null
  }
  return ok
}

export async function speakSaraStream(text: string): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return
  const gen = ++speakGen
  const ok = await connectSaraStream()
  if (!ok || gen !== speakGen || !manager) return
  try {
    await manager.speak({ type: 'text', input: clean })
  } catch {
    /* ara audio still plays; motion is best-effort */
  }
}

export function stopSaraStream(): void {
  speakGen += 1
  listeners.onTalking?.(false)
  try {
    manager?.interrupt?.()
  } catch {
    /* Talks V2 agents may not support interrupt */
  }
}

export function disconnectSaraStream(): void {
  stopSaraStream()
  const current = manager
  manager = null
  connectPromise = null
  srcObject = null
  if (videoEl) {
    try {
      videoEl.srcObject = null
    } catch {
      /* ignore */
    }
  }
  if (current) {
    try {
      void current.disconnect()
    } catch {
      /* ignore */
    }
  }
}
