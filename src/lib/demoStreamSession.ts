/**
 * One demo D-ID warm for the whole visit.
 * Redeem, Home, and Ask Sara share this controller so home → Ask Sara
 * does not mint a second session. A strict-mode remount and a route
 * change inside 400ms keep the in-flight connect. pagehide releases it.
 * This module does not speak.
 */

import {
  createDemoWarmController,
  type DemoWarmController,
  type DemoWarmSnapshot,
} from './demoStreamWarm.ts'
import {
  connectSaraStream,
  discardSaraStreamCreds,
  keepSaraStream,
  preloadSaraStream,
  retireDemoStream,
  saraStreamConnectBlocked,
} from './saraStream.ts'

const listeners = new Set<(snap: DemoWarmSnapshot) => void>()
let controller: DemoWarmController | null = null
let holdEpoch = 0
let hideBound = false

function emit(snap: DemoWarmSnapshot) {
  listeners.forEach((fn) => fn(snap))
}

function ensure(): DemoWarmController {
  if (controller) return controller
  controller = createDemoWarmController({
    connect: () => connectSaraStream(),
    retryFailure: () => !saraStreamConnectBlocked(),
    close: () => {
      retireDemoStream()
      // The next session must POST /stream so the per-IP gate counts it.
      discardSaraStreamCreds()
    },
    keep: () => keepSaraStream(),
    onChange: emit,
  })
  return controller
}

function bindPageHide() {
  if (hideBound || typeof window === 'undefined') return
  hideBound = true
  window.addEventListener('pagehide', () => {
    controller?.pageHide()
  })
}

export function demoStreamSnapshot(): DemoWarmSnapshot | null {
  return controller?.snapshot() ?? null
}

export function demoStreamOpenedAt(): number | null {
  return controller?.snapshot().openedAt ?? null
}

/** Send / Play / Test voice on the shared session. Does not open a second one. */
export function demoStreamSend(): { araThisTurn: boolean } {
  return ensure().send()
}

export function demoStreamReplyEnded(): void {
  controller?.replyEnded()
}

export function pageHideDemoStream(): void {
  controller?.pageHide()
}

export function reconnectDemoStream(): void {
  ensure().reconnectIfNeeded()
}

/**
 * Hold the one demo session. The returned release waits out StrictMode.
 * A newer hold (Ask Sara opening while Home unmounts) cancels that close.
 */
export function holdDemoStream(onChange?: (snap: DemoWarmSnapshot) => void): () => void {
  const ctl = ensure()
  const epoch = ++holdEpoch
  if (onChange) {
    listeners.add(onChange)
    onChange(ctl.snapshot())
  }
  preloadSaraStream()
  bindPageHide()
  ctl.mount()
  return () => {
    if (onChange) listeners.delete(onChange)
    // A stale screen close does not drop the next visit’s D-ID session.
    if (epoch !== holdEpoch) return
    ctl.unmount()
  }
}
