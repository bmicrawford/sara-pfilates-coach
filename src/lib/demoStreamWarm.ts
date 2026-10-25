/**
 * One muted D-ID session for a demo Ask Sara visit.
 * Opens when the screen opens, not when Send is tapped. Strict-mode
 * remount reuses that attempt. The Worker lease is not renewed; it
 * expires on its own. This module does not import the Agents SDK.
 */

export const DEMO_STREAM_IDLE_MS = 60_000
export const DEMO_STRICT_RELEASE_MS = 400

export type DemoWarmPhase = 'idle' | 'connecting' | 'live' | 'failed'

export type DemoWarmSnapshot = {
  phase: DemoWarmPhase
  openedAt: number | null
  liveAt: number | null
  connects: number
  closes: number
  /** Sessions started and not yet closed. Never more than one. */
  held: number
}

export type DemoWarmHooks = {
  now?: () => number
  schedule?: (fn: () => void, ms: number) => number
  clear?: (id: number) => void
  connect?: () => Promise<boolean>
  close?: () => void
  keep?: () => void
  onChange?: (snap: DemoWarmSnapshot) => void
  /**
   * Called when connect() returns false. True means the next Send may open
   * one new session. False (the default) keeps a cap / Worker denial sticky.
   */
  retryFailure?: () => boolean
}

type CloseReason = 'strict' | 'idle' | 'hide'

export function createDemoWarmController(hooks: DemoWarmHooks = {}) {
  const now = () => hooks.now?.() ?? Date.now()
  const schedule = hooks.schedule ?? ((fn, ms) => window.setTimeout(fn, ms) as unknown as number)
  const clear = hooks.clear ?? ((id) => window.clearTimeout(id))

  let phase: DemoWarmPhase = 'idle'
  let openedAt: number | null = null
  let liveAt: number | null = null
  let connects = 0
  let closes = 0
  let held = 0
  let closeTimer: number | null = null
  let closeReason: CloseReason | null = null
  let lazyAra = false
  let connectGen = 0
  /** A failed warm that was not a session cap or Worker denial. */
  let failedRetryable = false

  function snapshot(): DemoWarmSnapshot {
    return { phase, openedAt, liveAt, connects, closes, held }
  }

  function emit() {
    hooks.onChange?.(snapshot())
  }

  function clearTimer() {
    if (closeTimer != null) clear(closeTimer)
    closeTimer = null
    closeReason = null
  }

  function finishClose(why: CloseReason) {
    // The idle timer can outlive a connect that already failed. Leaving
    // phase at 'failed' stops the next Send from minting a second session.
    if (phase === 'failed' && held === 0) return
    connectGen += 1
    if (held > 0) {
      held -= 1
      closes += 1
      hooks.close?.()
    }
    phase = 'idle'
    if (why !== 'strict') lazyAra = true
    emit()
  }

  function requestClose(why: CloseReason, delay: number) {
    clearTimer()
    closeReason = why
    closeTimer = schedule(() => {
      closeTimer = null
      closeReason = null
      finishClose(why)
    }, delay)
  }

  function beginConnect() {
    if (phase === 'connecting' || phase === 'live' || phase === 'failed') {
      hooks.keep?.()
      emit()
      return
    }
    if (held > 0) {
      hooks.keep?.()
      emit()
      return
    }
    phase = 'connecting'
    connects += 1
    held += 1
    const gen = ++connectGen
    emit()
    void Promise.resolve(hooks.connect?.() ?? Promise.resolve(false)).then((ok) => {
      if (gen !== connectGen) return
      if (ok) {
        phase = 'live'
        if (liveAt == null) liveAt = now()
        emit()
        return
      }
      phase = 'failed'
      failedRetryable = hooks.retryFailure?.() === true
      if (held > 0) {
        held -= 1
        closes += 1
        hooks.close?.()
      }
      emit()
    })
  }

  /** A retryable failure is not sticky for the rest of the visit. */
  function reopenIfFailed(): boolean {
    if (phase !== 'failed' || !failedRetryable) return false
    failedRetryable = false
    phase = 'idle'
    beginConnect()
    return true
  }

  return {
    snapshot,
    /** Screen opened. Starts at most one connect. A strict-mode remount keeps the first. */
    mount() {
      if (openedAt == null) openedAt = now()
      if (closeReason === 'strict') {
        clearTimer()
        hooks.keep?.()
        emit()
        return
      }
      beginConnect()
    },
    /** React cleanup. The close waits out StrictMode's remount. */
    unmount() {
      if (phase === 'idle' && held === 0 && closeReason == null) return
      requestClose('strict', DEMO_STRICT_RELEASE_MS)
    },
  /** Background / frozen page. Closes immediately so the slot is not held. */
  pageHide() {
    clearTimer()
    // A failed warm already released its slot. Do not mark the next Send as a reopen.
    if (phase === 'failed' && held === 0) {
      emit()
      return
    }
    lazyAra = true
    if (held === 0 && phase === 'idle') {
      emit()
      return
    }
    finishClose('hide')
  },
    /** Last reply finished. Close after a minute with no new Send. */
    replyEnded() {
      if (phase === 'idle' || phase === 'failed') return
      requestClose('idle', DEMO_STREAM_IDLE_MS)
    },
    /**
     * Send / Play / Test voice. After an idle or page-hide close, this turn
     * stays on ara and a new session starts for a later reply.
     */
    send(): { araThisTurn: boolean } {
      const araThisTurn = lazyAra
      lazyAra = false
      if (closeReason === 'idle') clearTimer()
      if (reopenIfFailed()) return { araThisTurn }
      if (phase === 'idle') beginConnect()
      else hooks.keep?.()
      return { araThisTurn }
    },
    /**
     * Tap to see Sara. Reconnect when the warm phase is not live, including
     * a retryable failure. A cap / Worker denial stays failed.
     */
    reconnectIfNeeded() {
      if (phase === 'live' || phase === 'connecting') {
        hooks.keep?.()
        emit()
        return
      }
      if (reopenIfFailed()) return
      if (phase === 'idle') beginConnect()
      else hooks.keep?.()
    },
  }
}

export type DemoWarmController = ReturnType<typeof createDemoWarmController>
