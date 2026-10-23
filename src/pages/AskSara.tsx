import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TalkingPortrait } from '../components/TalkingPortrait'
import { askSaraRemote, isSaraUnreachable } from '../lib/askSara'
import { isDemoVoiceOnly } from '../lib/demoPass'
import {
  DEMO_DID_FRAME_BUDGET_MS,
  didWebRtcSilencedBySilentSwitch,
  planDemoVoice,
} from '../lib/demoVoicePlan'
import { readChat, readSession, writeChat } from '../lib/mockServer'
import { askEmptyHint, askIntro } from '../lib/prospectCopy'
import { isSaraBusy, SARA_PASS_REQUIRED_MESSAGE, SARA_UNKNOWN_PASS_MESSAGE } from '../lib/saraGate'
import {
  bindSaraStreamVideo,
  connectSaraStream,
  isSaraStreamSpeechLive,
  preloadSaraStream,
  releaseSaraStream,
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
    })
    preloadSaraStream()
    return () => {
      demoTicket.current += 1
      if (demoPoll.current) window.clearInterval(demoPoll.current)
      demoPoll.current = 0
      demoEvaluateRef.current = null
      setSaraStreamCallbacks({})
      releaseSaraStream()
      stopSaraSpeech()
    }
  }, [playAra, voiceOnly])

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
    unlockSaraSpeech()
    unlockSaraStream()
    void connectSaraStream()
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
    const ios = didWebRtcSilencedBySilentSwitch(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints,
    )
    setSaraStreamKeepMuted(ios)
    const startedAt = Date.now()
    let framesAt: number | null = null
    let chunkAt: number | null = null
    let committed = false

    const finish = (choice: 'did-audio' | 'did-visual-ara' | 'ara') => {
      if (committed || ticket !== demoTicket.current) return
      committed = true
      clearDemoPoll()
      if (choice === 'did-audio') {
        setConcealStream(false)
        setSaraStreamKeepMuted(false)
        dropHeldSaraSpeech()
        streamVoiceRef.current = true
        setVoiceNote(null)
        setSpeaking(true)
        return
      }
      if (choice === 'did-visual-ara') {
        setConcealStream(false)
        setSaraStreamKeepMuted(true)
        settleSaraStreamVoice('visual')
        streamVoiceRef.current = false
        araPlayingRef.current = true
        releaseHeldSaraSpeech()
        return
      }
      setConcealStream(true)
      settleSaraStreamVoice('ara')
      streamVoiceRef.current = false
      araPlayingRef.current = true
      releaseHeldSaraSpeech()
    }

    const evaluate = () => {
      if (committed || ticket !== demoTicket.current) return
      const now = Date.now()
      const speechFramesLive = isSaraStreamSpeechLive()
      if (speechFramesLive && framesAt == null) framesAt = now
      const chunkReady = saraSpeechChunkReady()
      if (chunkReady && chunkAt == null) chunkAt = now
      const choice = planDemoVoice({
        araStarted: false,
        didFailed: demoStreamFailedRef.current,
        budgetExceeded: now - startedAt >= DEMO_DID_FRAME_BUDGET_MS,
        speechFramesLive,
        chunkReady,
        framesReadyAt: framesAt,
        chunkReadyAt: chunkAt,
        now,
        iosSilentSwitch: ios,
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
    void speakSaraStream(text).then((outcome) => {
      if (ticket !== demoTicket.current) return
      if (outcome !== 'heard') demoStreamFailedRef.current = true
      evaluate()
    })
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
    unlockSaraSpeech()
    unlockSaraStream()
    void connectSaraStream()
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
          onVideoEl={onVideoEl}
          onVideoLive={onVideoLive}
        />
      </div>

      <div className="ask-sara-overlay relative z-10 flex h-full min-h-0 flex-col">
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
          <p className="ask-sara-greeting px-5 pt-0.5 text-center text-sm font-semibold">
            {busy ? <ListeningLine /> : intro.sub}
          </p>
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
                      void connectSaraStream()
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
