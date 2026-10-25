import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TalkingPortrait } from '../components/TalkingPortrait'
import { askSaraRemote, isSaraUnreachable } from '../lib/askSara'
import { isDemoVoiceOnly } from '../lib/demoPass'
import {
  demoStreamOpenedAt,
  demoStreamReplyEnded,
  demoStreamSend,
  demoStreamSnapshot,
  holdDemoStream,
  pageHideDemoStream,
  reconnectDemoStream,
} from '../lib/demoStreamSession'
import type { DemoWarmSnapshot } from '../lib/demoStreamWarm'
import {
  DEMO_DID_FRAME_BUDGET_MS,
  DEMO_SEND_LIVE_BUDGET_MS,
  didWebRtcSilencedBySilentSwitch,
  planDemoVoice,
  SARA_DEMO_SILENT_HINT,
  SARA_GETTING_READY,
} from '../lib/demoVoicePlan'
import { saraDebugOn } from '../lib/saraDebug'
import { IOS_WEBRTC_BUDGET_MS, SARA_SEE_LABEL } from '../lib/saraStreamGesture'
import { readChat, readSession, writeChat } from '../lib/mockServer'
import { askEmptyHint, askIntro } from '../lib/prospectCopy'
import { isSaraBusy, SARA_PASS_REQUIRED_MESSAGE, SARA_UNKNOWN_PASS_MESSAGE } from '../lib/saraGate'
import {
  bindSaraStreamVideo,
  connectSaraStream,
  gestureUnlockSaraStream,
  isSaraStreamSpeechLive,
  noteStreamFallback,
  preloadSaraStream,
  releaseSaraStream,
  saraStreamConnectBlocked,
  saraStreamDebugFacts,
  saraStreamHasFrames,
  saraStreamPhase,
  saraStreamTimingLabel,
  setSaraStreamTapReconnect,
  SARA_STREAM_CAPPED_NOTE,
  setSaraStreamCallbacks,
  setSaraStreamKeepMuted,
  setSaraStreamUserMuted,
  settleSaraStreamVoice,
  shouldShowSaraStream,
  speakSaraStream,
  stopSaraStream,
  unlockSaraStream,
} from '../lib/saraStream'
import {
  dropHeldSaraSpeech,
  holdSaraSpeech,
  isSaraMuted,
  isVoiceReady,
  playCachedSaraSpeech,
  releaseHeldSaraSpeech,
  saraSpeechChunkReady,
  setSaraMuted,
  SARA_SILENT_SWITCH_HINT,
  SARA_TAP_TO_HEAR,
  SARA_TEST_VOICE_LINE,
  speakSara,
  stopSaraSpeech,
  unlockSaraSpeech,
} from '../lib/speakSara'
import { nowIso, uid } from '../lib/storage'
import type { ChatMessage } from '../lib/types'

function ListeningLine() {
  return (
    <span className="sara-listening" data-sara-listening="true">
      Sara is listening
      <span className="sara-listening-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}

export function AskSara() {
  const voiceOnly = isDemoVoiceOnly(readSession()?.redeemToken)
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat())
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [streamReady, setStreamReady] = useState(false)
  const [streamTalking, setStreamTalking] = useState(false)
  const [videoLive, setVideoLive] = useState(false)
  const [streamCapped, setStreamCapped] = useState(false)
  const [muted, setMuted] = useState(() => isSaraMuted())
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const [needsTap, setNeedsTap] = useState(false)
  const [concealStream, setConcealStream] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const retryTextRef = useRef<string | null>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  /** True while D-ID stream audio is the heard voice — do not let a late STOP cancel ara. */
  const streamVoiceRef = useRef(false)
  const fallbackTextRef = useRef<string | null>(null)
  const araPlayingRef = useRef(false)
  const demoTicket = useRef(0)
  const demoPoll = useRef(0)
  const demoStreamFailedRef = useRef(false)
  const demoEvaluateRef = useRef<(() => void) | null>(null)
  const demoForceAraRef = useRef(false)
  const demoUnmuteFailedRef = useRef(false)
  const demoUnmutedRef = useRef(false)
  const iosGaveUpRef = useRef(false)
  const demoPathRef = useRef<'did-audio' | 'did-visual-ara' | 'ara' | null>(null)
  const demoSendAtRef = useRef(0)
  const [warmSnap, setWarmSnap] = useState<DemoWarmSnapshot | null>(() => demoStreamSnapshot())
  const [debugVoice, setDebugVoice] = useState<'did-audio' | 'did-visual-ara' | 'ara' | null>(null)
  const [needsSee, setNeedsSee] = useState(false)
  const [debugFacts, setDebugFacts] = useState(() => saraStreamDebugFacts())
  const showDebug = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('debug') === '1' || saraDebugOn(window.location.search)
  })[0]
  const iosPhone = didWebRtcSilencedBySilentSwitch(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    typeof navigator === 'undefined' ? '' : navigator.platform,
    typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
  )

  const onVideoEl = useCallback((el: HTMLVideoElement | null) => {
    bindSaraStreamVideo(el)
  }, [])

  const onVideoLive = useCallback((live: boolean) => {
    setVideoLive(live)
    demoEvaluateRef.current?.()
  }, [])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    setSaraStreamUserMuted(muted)
  }, [muted])

  const playAra = useCallback((text: string) => {
    if (mutedRef.current || !isVoiceReady() || araPlayingRef.current) return
    retryTextRef.current = text
    araPlayingRef.current = true
    streamVoiceRef.current = false
    setVoiceNote(null)
    setNeedsTap(false)
    void speakSara(text, {
      onStart: () => {
        setNeedsTap(false)
        setSpeaking(true)
      },
      onEnd: () => {
        araPlayingRef.current = false
        setSpeaking(false)
      },
      onError: (message) => {
        araPlayingRef.current = false
        setSpeaking(false)
        setVoiceNote(message)
      },
      onBlocked: () => {
        araPlayingRef.current = false
        setSpeaking(false)
        setNeedsTap(true)
      },
    })
  }, [])

  useEffect(() => {
    setSaraStreamCallbacks({
      onTalking: (talking) => {
        setStreamTalking(talking)
        demoEvaluateRef.current?.()
        if (!talking && demoPathRef.current === 'did-audio') {
          demoPathRef.current = null
          if (voiceOnly) demoStreamReplyEnded()
        }
        if (!talking && streamVoiceRef.current) {
          streamVoiceRef.current = false
          setSpeaking(false)
        }
      },
      onReady: setStreamReady,
      onStatus: (status) => {
        if (status === 'session_capped') setStreamCapped(true)
        if (status === 'live') setStreamCapped(false)
      },
      onVoiceFallback: () => {
        if (voiceOnly) {
          demoStreamFailedRef.current = true
          demoEvaluateRef.current?.()
          return
        }
        const text = fallbackTextRef.current
        if (text) playAra(text)
      },
      onSeeSara: (blocked) => setNeedsSee(blocked),
      onStreamAudible: (ok) => {
        demoUnmutedRef.current = ok
        demoUnmuteFailedRef.current = !ok
        if (!ok) noteStreamFallback('unmute')
        demoEvaluateRef.current?.()
      },
    })
    preloadSaraStream()
    setSaraStreamTapReconnect(() => {
      if (voiceOnly) {
        reconnectDemoStream()
        return
      }
      if (!saraStreamConnectBlocked()) void connectSaraStream()
    })
    const releaseWarm = voiceOnly ? holdDemoStream((snap) => setWarmSnap(snap)) : null
    const onPageHide = () => {
      if (voiceOnly) pageHideDemoStream()
    }
    window.addEventListener('pagehide', onPageHide)
    let iosTimer = 0
    if (voiceOnly && iosPhone) {
      const opened = demoStreamOpenedAt() ?? Date.now()
      const remain = IOS_WEBRTC_BUDGET_MS - (Date.now() - opened)
      const giveUp = () => {
        if (saraStreamPhase() === 'live') return
        iosGaveUpRef.current = true
        noteStreamFallback('ios-25s')
        demoEvaluateRef.current?.()
        setDebugFacts(saraStreamDebugFacts())
      }
      if (remain <= 0) giveUp()
      else iosTimer = window.setTimeout(giveUp, remain)
    }
    return () => {
      if (iosTimer) window.clearTimeout(iosTimer)
      window.removeEventListener('pagehide', onPageHide)
      demoTicket.current += 1
      if (demoPoll.current) window.clearInterval(demoPoll.current)
      demoPoll.current = 0
      demoEvaluateRef.current = null
      releaseWarm?.()
      setSaraStreamTapReconnect(null)
      setSaraStreamCallbacks({})
      releaseSaraStream()
      stopSaraSpeech()
    }
  }, [playAra, voiceOnly, iosPhone])

  useEffect(() => {
    if (warmSnap?.phase === 'live' && iosGaveUpRef.current) {
      iosGaveUpRef.current = false
      noteStreamFallback('late-live')
    }
  }, [warmSnap?.phase])

  useEffect(() => {
    if (!showDebug) return
    const pull = () => setDebugFacts(saraStreamDebugFacts())
    pull()
    const timer = window.setInterval(pull, 400)
    return () => window.clearInterval(timer)
  }, [showDebug])

  const streaming =
    shouldShowSaraStream({ streamReady, speaking, streamTalking, videoLive }) && !concealStream
  const live = speaking || streamTalking

  const clearDemoPoll = () => {
    if (demoPoll.current) window.clearInterval(demoPoll.current)
    demoPoll.current = 0
    demoEvaluateRef.current = null
  }

  const haltPlayback = () => {
    demoTicket.current += 1
    clearDemoPoll()
    demoStreamFailedRef.current = false
    streamVoiceRef.current = false
    araPlayingRef.current = false
    fallbackTextRef.current = null
    setConcealStream(false)
    stopSaraSpeech()
    stopSaraStream()
    setSpeaking(false)
    setStreamTalking(false)
    setNeedsTap(false)
  }

  const noteDemoSend = () => {
    if (!voiceOnly) return
    demoSendAtRef.current = Date.now()
    const turn = demoStreamSend()
    demoForceAraRef.current = Boolean(turn?.araThisTurn)
  }

  const testVoice = () => {
    if (busy) return
    if (mutedRef.current) {
      mutedRef.current = false
      setMuted(false)
      setSaraMuted(false)
    }
    setVoiceNote(null)
    setNeedsTap(false)
    haltPlayback()
    noteDemoSend()
    unlockSaraSpeech()
    unlockSaraStream()
    speakDemoReply(SARA_TEST_VOICE_LINE)
  }

  const hearFromTap = () => {
    const played = playCachedSaraSpeech()
    if (!played) unlockSaraSpeech()
    setNeedsTap(false)
    setVoiceNote(null)
    if (played) {
      araPlayingRef.current = true
      return
    }
    const text = retryTextRef.current
    if (text) playAra(text)
  }

  const speakDemoReply = (text: string) => {
    if (isSaraBusy(text) || mutedRef.current || !isVoiceReady()) return
    const ticket = demoTicket.current
    fallbackTextRef.current = text
    araPlayingRef.current = false
    demoStreamFailedRef.current = false
    setConcealStream(false)
    // Re-read as the connect finishes. A stale ios-gave-up flag must not win
    // once the session is live. If it is still not live by Send+6s, this
    // turn uses ara and a later reply can use the video.
    const sendAt = demoSendAtRef.current || Date.now()
    const forceAra = demoForceAraRef.current
    demoForceAraRef.current = false
    demoUnmuteFailedRef.current = false
    demoUnmutedRef.current = false
    setSaraStreamKeepMuted(false)
    let committed = false
    let didSpeak = false
    let speakArmedAt = 0

    const armSpeak = () => {
      if (didSpeak || forceAra || iosGaveUpRef.current) return
      if (saraStreamPhase() !== 'live') return
      if (Date.now() - sendAt >= DEMO_SEND_LIVE_BUDGET_MS) return
      didSpeak = true
      speakArmedAt = Date.now()
      iosGaveUpRef.current = false
      void speakSaraStream(text).then((outcome) => {
        if (ticket !== demoTicket.current) return
        if (outcome !== 'heard') demoStreamFailedRef.current = true
        evaluate()
      })
    }

    const finish = (choice: 'did-audio' | 'did-visual-ara' | 'ara') => {
      if (committed || ticket !== demoTicket.current) return
      committed = true
      clearDemoPoll()
      if (choice === 'did-audio') {
        noteStreamFallback('—')
        setConcealStream(false)
        setSaraStreamKeepMuted(false)
        dropHeldSaraSpeech()
        streamVoiceRef.current = true
        demoPathRef.current = 'did-audio'
        setDebugVoice('did-audio')
        setVoiceNote(null)
        setSpeaking(true)
        return
      }
      if (choice === 'did-visual-ara') {
        setConcealStream(false)
        setSaraStreamKeepMuted(true)
        settleSaraStreamVoice('visual')
        streamVoiceRef.current = false
        demoPathRef.current = 'did-visual-ara'
        setDebugVoice('did-visual-ara')
        if (!demoUnmuteFailedRef.current && !iosGaveUpRef.current) noteStreamFallback('visual')
        araPlayingRef.current = true
        releaseHeldSaraSpeech()
        return
      }
      setConcealStream(true)
      const prior = saraStreamDebugFacts().fallback
      const specific = prior.startsWith('play-') || prior === 'ice-failed' || prior === 'unmute' || prior === 'no-track' || prior === 'no-session'
      if (iosGaveUpRef.current) noteStreamFallback('ios-25s')
      else if (!specific && !didSpeak) noteStreamFallback('cold')
      else if (!specific) noteStreamFallback('budget')
      settleSaraStreamVoice('ara')
      streamVoiceRef.current = false
      demoPathRef.current = 'ara'
      setDebugVoice('ara')
      araPlayingRef.current = true
      releaseHeldSaraSpeech()
    }

    const evaluate = () => {
      if (committed || ticket !== demoTicket.current) return
      const now = Date.now()
      const phase = saraStreamPhase()
      // The warm controller stays 'failed' after a cap or a 429. saraStreamPhase()
      // can read 'idle' once that session is released, and that must not hold ara.
      const warmPhase = demoStreamSnapshot()?.phase
      if (phase === 'live' || warmPhase === 'live') iosGaveUpRef.current = false
      armSpeak()
      const liveNow = phase === 'live' || warmPhase === 'live'
      const sendBudgetExceeded = now - sendAt >= DEMO_SEND_LIVE_BUDGET_MS
      const awaitingLive =
        !didSpeak &&
        !forceAra &&
        !demoStreamFailedRef.current &&
        !iosGaveUpRef.current &&
        !sendBudgetExceeded &&
        warmPhase === 'connecting'
      const speechFramesLive = isSaraStreamSpeechLive()
      const chunkReady = saraSpeechChunkReady()
      const choice = planDemoVoice({
        araStarted: false,
        didFailed: demoStreamFailedRef.current || iosGaveUpRef.current,
        budgetExceeded: didSpeak
          ? speakArmedAt > 0 && now - speakArmedAt >= DEMO_DID_FRAME_BUDGET_MS
          : sendBudgetExceeded,
        speechFramesLive,
        chunkReady,
        streamWarm: didSpeak && liveNow && !iosGaveUpRef.current,
        awaitingLive,
        unmuted: demoUnmutedRef.current,
        unmuteBlocked: demoUnmuteFailedRef.current,
        framesVisible: saraStreamHasFrames(),
      })
      if (choice !== 'wait') finish(choice)
    }

    demoEvaluateRef.current = evaluate
    holdSaraSpeech(text, {
      onStart: () => {
        setNeedsTap(false)
        setSpeaking(true)
      },
      onEnd: () => {
        araPlayingRef.current = false
        setSpeaking(false)
        if (voiceOnly) demoStreamReplyEnded()
      },
      onError: (message) => {
        araPlayingRef.current = false
        setSpeaking(false)
        setVoiceNote(message)
      },
      onBlocked: () => {
        araPlayingRef.current = false
        setSpeaking(false)
        setNeedsTap(true)
      },
      onFirstChunk: () => evaluate(),
    })
    if (demoPoll.current) window.clearInterval(demoPoll.current)
    demoPoll.current = window.setInterval(evaluate, 100)
    armSpeak()
    evaluate()
  }

  const speakReply = (text: string) => {
    if (isSaraBusy(text)) return
    if (voiceOnly) {
      speakDemoReply(text)
      return
    }
    setSaraStreamKeepMuted(false)
    fallbackTextRef.current = text
    araPlayingRef.current = false
    unlockSaraStream()
    // D-ID speak as soon as Grok text exists. Heard voice is stream audio when
    // speak has started AND video frames are playing; ara only after failure
    // / cap / timeout with no playable AV — not while D-ID is still coming up.
    if (mutedRef.current) {
      void speakSaraStream(text)
      return
    }
    void (async () => {
      const outcome = await speakSaraStream(text)
      if (outcome === 'heard') {
        streamVoiceRef.current = true
        setVoiceNote(null)
        setSpeaking(true)
        return
      }
      playAra(text)
    })()
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    haltPlayback()
    if (saraStreamPhase() === 'live') iosGaveUpRef.current = false
    noteDemoSend()
    unlockSaraSpeech()
    unlockSaraStream()
    if (!voiceOnly) void connectSaraStream()
    const you: ChatMessage = { id: uid(), from: 'you', text, at: nowIso() }
    const prior = messages
    setMessages((cur) => [...cur, you])
    setDraft('')
    setBusy(true)
    const reply = await askSaraRemote(text, prior)
    const sara: ChatMessage = { id: uid(), from: 'sara', text: reply, at: nowIso() }
    setMessages((cur) => {
      const next = [...cur, sara]
      writeChat(next)
      return next
    })
    setBusy(false)
    if (
      isSaraBusy(reply) ||
      reply === SARA_UNKNOWN_PASS_MESSAGE ||
      reply === SARA_PASS_REQUIRED_MESSAGE
    ) {
      if (!voiceOnly) settleSaraStreamVoice('idle')
      return
    }
    if (isSaraUnreachable(reply)) {
      settleSaraStreamVoice('idle')
      setVoiceNote(
        "I couldn't reach my voice either. Same connection — try Send again in a moment.",
      )
      return
    }
    speakReply(reply)
  }

  const lastSara = [...messages].reverse().find((m) => m.from === 'sara')

  const listening = busy || Boolean(draft.trim())
  const intro = askIntro(voiceOnly, live, listening)

  return (
    <main className="ask-sara relative isolate h-dvh max-h-dvh overflow-hidden">
      <div className="ask-sara-stage">
        <TalkingPortrait
          talking={speaking}
          listening={busy}
          streaming={streaming}
          preparing={voiceOnly && warmSnap?.phase === 'connecting'}
          onVideoEl={onVideoEl}
          onVideoLive={onVideoLive}
        />
      </div>

      <div className="ask-sara-overlay relative z-10 flex h-full min-h-0 flex-col">
        {needsSee ? (
          <button type="button" className="sara-see" data-sara-see="true" onClick={() => gestureUnlockSaraStream()}>
            {SARA_SEE_LABEL}
          </button>
        ) : null}
        <div className="ask-sara-chrome shrink-0 pb-6">
          <header className="flex items-center justify-between px-5 pb-2 safe-top">
            <Link to="/" className="ask-sara-chip text-sm font-semibold">
              ← Home
            </Link>
            <p className="ask-sara-chip text-xs font-semibold uppercase tracking-[0.18em]">Ask Sara</p>
            <button
              type="button"
              className="ask-sara-chip text-xs font-semibold"
              onClick={() => {
                if (live && !muted) {
                  haltPlayback()
                  return
                }
                const next = !muted
                setMuted(next)
                setSaraMuted(next)
                if (next) haltPlayback()
              }}
            >
              {muted ? 'Unmute' : live ? 'Stop' : 'Mute'}
            </button>
          </header>
          <p className="ask-sara-greeting ask-sara-greeting-lead px-5 text-center font-serif text-xl font-bold">
            {intro.title}
          </p>
          {voiceOnly && warmSnap?.phase === 'connecting' ? (
            <p className="sara-ready-cue mx-auto mt-2 w-fit" data-sara-ready-cue="true">
              {SARA_GETTING_READY}
            </p>
          ) : null}
          <p className="ask-sara-greeting px-5 pt-0.5 text-center text-sm font-semibold">
            {busy ? <ListeningLine /> : intro.sub}
          </p>
          {voiceOnly && iosPhone ? (
            <p className="px-5 pt-1 text-center text-xs font-semibold" data-sara-silent-hint="true">
              {SARA_DEMO_SILENT_HINT}
            </p>
          ) : null}
          {showDebug ? (
            <p className="px-5 pt-1 text-center text-xs font-semibold" data-sara-stream-debug="true">
              {`stream ${warmSnap?.phase ?? 'idle'} · live ${
                warmSnap?.openedAt != null && warmSnap.liveAt != null
                  ? `${warmSnap.liveAt - warmSnap.openedAt}ms`
                  : '—'
              } · voice ${debugVoice ?? '—'} · play ${debugFacts.play} · muted ${
                debugFacts.muted == null ? '—' : debugFacts.muted ? '1' : '0'
              } · w ${debugFacts.videoWidth} · rs ${debugFacts.readyState} · ice ${debugFacts.ice} · track ${
                debugFacts.track ? 'yes' : 'no'
              } · fallback ${debugFacts.fallback} · ${saraStreamTimingLabel()}`}
            </p>
          ) : null}
          {voiceOnly ? (
            <div className="px-5 pt-2 text-center">
              <button
                type="button"
                data-sara-test-voice="true"
                className="ask-sara-chip text-xs font-semibold disabled:opacity-40"
                disabled={busy}
                onClick={testVoice}
              >
                Test voice
              </button>
            </div>
          ) : null}
        </div>

        <div className="ask-sara-mid flex min-h-0 flex-1 flex-col justify-end px-5 pb-2 pt-3">
          {needsTap ? (
            <div className="ask-sara-hear mb-2 px-3 py-2 text-center" data-sara-hear-fallback="true">
              <button
                type="button"
                data-sara-tap-hear="true"
                className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white"
                onClick={hearFromTap}
              >
                {SARA_TAP_TO_HEAR}
              </button>
              <p className="mt-1 text-xs font-semibold leading-snug">{SARA_SILENT_SWITCH_HINT}</p>
            </div>
          ) : voiceNote ? (
            <p className="ask-sara-note mb-2 text-center text-xs font-semibold leading-snug">{voiceNote}</p>
          ) : live && streamCapped && !voiceOnly ? (
            <p className="ask-sara-note mb-2 text-center text-xs font-semibold leading-snug">{SARA_STREAM_CAPPED_NOTE}</p>
          ) : null}

          <div className="ask-sara-panel min-h-0 space-y-3 overflow-y-auto overscroll-contain">
            {messages.length === 0 ? (
              <p className="text-sm font-semibold leading-relaxed">{askEmptyHint(voiceOnly)}</p>
            ) : null}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[90%] text-sm font-semibold leading-relaxed ${
                  m.from === 'you' ? 'ml-auto text-right' : ''
                }`}
              >
                {m.text}
                {m.from === 'sara' &&
                m.id === lastSara?.id &&
                isVoiceReady() &&
                !isSaraUnreachable(m.text) &&
                !isSaraBusy(m.text) &&
                m.text !== SARA_UNKNOWN_PASS_MESSAGE &&
                m.text !== SARA_PASS_REQUIRED_MESSAGE ? (
                  <button
                    type="button"
                    className="mt-2 block text-xs font-semibold"
                    onClick={() => {
                      if (live) {
                        haltPlayback()
                        return
                      }
                      unlockSaraSpeech()
                      unlockSaraStream()
                      if (voiceOnly && saraStreamPhase() !== 'live') {
                        const ice = saraStreamDebugFacts().ice
                        noteStreamFallback(iosGaveUpRef.current ? 'ios-25s' : ice === 'failed' ? 'ice-failed' : 'no-session')
                      } else if (voiceOnly && !saraStreamDebugFacts().track) {
                        const ice = saraStreamDebugFacts().ice
                        noteStreamFallback(ice === 'failed' ? 'ice-failed' : 'no-track')
                      }
                      noteDemoSend()
                      if (!voiceOnly) void connectSaraStream()
                      speakReply(m.text)
                    }}
                  >
                    {live ? 'Stop' : 'Play'}
                  </button>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className="text-sm font-semibold">
                <ListeningLine />
              </div>
            ) : null}
            <div ref={bottom} />
          </div>
        </div>

        <form
          onSubmit={send}
          className="ask-sara-compose shrink-0 space-y-2.5 px-5 pt-2 safe-bottom"
        >
          <label className="block">
            <span className="sr-only">Your note</span>
            <textarea
              className="ask-sara-input min-h-[4.5rem] w-full resize-none rounded-2xl px-3.5 py-3 outline-none placeholder:text-ink-faint disabled:opacity-70"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What’s going on?"
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-full bg-sage py-3 font-semibold text-white shadow-card disabled:opacity-40"
            disabled={!draft.trim() || busy}
          >
            {busy ? 'Sara is listening…' : 'Send to Sara'}
          </button>
        </form>
      </div>
    </main>
  )
}
