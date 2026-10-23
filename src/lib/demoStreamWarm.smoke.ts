import {
  DEMO_STREAM_IDLE_MS,
  DEMO_STRICT_RELEASE_MS,
  createDemoWarmController,
} from './demoStreamWarm.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('OK ', msg)
  }
}

type Timer = { id: number; at: number; fn: () => void }

function fakeClock() {
  let now = 1_000
  let seq = 1
  const timers: Timer[] = []
  return {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const id = seq++
      timers.push({ id, at: now + ms, fn })
      return id
    },
    clear(id: number) {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    advance(ms: number) {
      now += ms
      for (let guard = 0; guard < 10; guard += 1) {
        const due = timers
          .filter((timer) => timer.at <= now)
          .sort((a, b) => a.at - b.at || a.id - b.id)
        if (!due.length) return
        const timer = due[0]
        const index = timers.findIndex((row) => row.id === timer.id)
        if (index >= 0) timers.splice(index, 1)
        timer.fn()
      }
    },
    pending: () => timers.length,
  }
}

function harness(connectResult: boolean | 'later' = true) {
  const clock = fakeClock()
  const connects: Array<(ok: boolean) => void> = []
  let connectCalls = 0
  let closeCalls = 0
  let keepCalls = 0
  const ctl = createDemoWarmController({
    now: clock.now,
    schedule: clock.schedule,
    clear: clock.clear,
    connect: () => {
      connectCalls += 1
      if (connectResult === 'later') {
        return new Promise((resolve) => {
          connects.push(resolve)
        })
      }
      return Promise.resolve(connectResult)
    },
    close: () => {
      closeCalls += 1
    },
    keep: () => {
      keepCalls += 1
    },
  })
  return {
    clock,
    ctl,
    connects,
    counts: () => ({ connectCalls, closeCalls, keepCalls }),
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

{
  const { ctl, counts } = harness(true)
  ctl.mount()
  ctl.mount()
  await flush()
  const snap = ctl.snapshot()
  assert(counts().connectCalls === 1, 'opening the screen twice does not mint a second D-ID session')
  assert(snap.phase === 'live' && snap.held === 1 && snap.closes === 0, 'the warmed session stays open and muted')
  assert(snap.liveAt != null && snap.openedAt != null && snap.liveAt >= snap.openedAt, 'live time is measured from screen open')
}

{
  const { ctl, counts, connects } = harness('later')
  ctl.mount()
  ctl.unmount()
  ctl.mount()
  assert(counts().connectCalls === 1, 'strict-mode remount reuses the in-flight D-ID connect')
  assert(counts().closeCalls === 0 && ctl.snapshot().held === 1, 'strict-mode remount does not close the session')
  connects[0]?.(true)
  await flush()
  assert(ctl.snapshot().phase === 'live' && ctl.snapshot().closes === 0, 'the first connect is the one that goes live')
}

{
  const { clock, ctl, counts } = harness(true)
  ctl.mount()
  await flush()
  ctl.unmount()
  clock.advance(DEMO_STRICT_RELEASE_MS)
  const snap = ctl.snapshot()
  assert(counts().closeCalls === 1 && snap.held === 0 && snap.phase === 'idle', 'leaving the screen closes the D-ID session')
  assert(snap.closes === snap.connects, 'every opened session is closed — no leak')
}

{
  const { clock, ctl, counts } = harness(true)
  ctl.mount()
  await flush()
  ctl.replyEnded()
  clock.advance(DEMO_STREAM_IDLE_MS - 1)
  assert(counts().closeCalls === 0 && ctl.snapshot().phase === 'live', 'the session stays up just inside the idle minute')
  clock.advance(1)
  assert(counts().closeCalls === 1 && ctl.snapshot().held === 0, '60s after the last reply closes the session')
  const turn = ctl.send()
  assert(turn.araThisTurn === true, 'the Send after an idle close plays ara for that turn')
  await flush()
  assert(counts().connectCalls === 2 && ctl.snapshot().held === 1, 'that Send reopens one session for a later reply')
  const again = ctl.send()
  assert(again.araThisTurn === false && counts().connectCalls === 2, 'a later Send reuses the reopened session')
}

{
  const { ctl, counts } = harness(true)
  ctl.mount()
  await flush()
  ctl.pageHide()
  assert(counts().closeCalls === 1 && ctl.snapshot().held === 0 && ctl.snapshot().phase === 'idle', 'page hide closes the session immediately')
  const turn = ctl.send()
  assert(turn.araThisTurn === true, 'the next Send after page hide plays ara for that turn')
  await flush()
  assert(ctl.snapshot().held === 1 && counts().connectCalls === 2, 'page hide does not leave two sessions open')
}

{
  const { ctl, counts, connects } = harness('later')
  ctl.mount()
  ctl.pageHide()
  connects[0]?.(true)
  await flush()
  assert(ctl.snapshot().phase === 'idle' && ctl.snapshot().held === 0, 'a connect that finishes after page hide is not kept')
  assert(counts().closeCalls === 1, 'page hide closes the in-flight session once')
}

{
  const { ctl, counts } = harness(false)
  ctl.mount()
  await flush()
  const snap = ctl.snapshot()
  assert(snap.phase === 'failed' && snap.held === 0 && snap.closes === 1, 'a 429-style connect failure closes and does not stay held')
  const turn = ctl.send()
  await flush()
  assert(turn.araThisTurn === false && counts().connectCalls === 1, 'a failed warm does not open another session on Send')
  ctl.pageHide()
  const afterHide = ctl.send()
  await flush()
  assert(
    afterHide.araThisTurn === false && counts().connectCalls === 1 && ctl.snapshot().phase === 'failed',
    'page hide after a failed warm does not mint another session',
  )
}

{
  const { clock, ctl, counts, connects } = harness('later')
  ctl.mount()
  ctl.replyEnded()
  connects[0]?.(false)
  await flush()
  assert(ctl.snapshot().phase === 'failed' && counts().closeCalls === 1, 'a connect that fails after the reply still closes once')
  clock.advance(DEMO_STREAM_IDLE_MS)
  ctl.send()
  await flush()
  assert(
    counts().connectCalls === 1 && ctl.snapshot().phase === 'failed' && ctl.snapshot().held === 0,
    'the idle timer does not reopen a warm that already failed',
  )
}

{
  const { clock, ctl, counts } = harness(true)
  ctl.mount()
  await flush()
  ctl.replyEnded()
  ctl.send()
  clock.advance(DEMO_STREAM_IDLE_MS)
  assert(counts().closeCalls === 0 && ctl.snapshot().phase === 'live', 'Send cancels the idle close')
}

if (process.exitCode) {
  console.error('demo stream warm smoke failed')
  process.exit(1)
}
console.log('demo stream warm smoke passed')
