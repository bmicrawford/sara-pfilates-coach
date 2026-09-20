import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TalkingPortrait } from '../components/TalkingPortrait'
import { askSaraRemote, isSaraUnreachable } from '../lib/askSara'
import { readChat, writeChat } from '../lib/mockServer'
import {
  bindSaraStreamVideo,
  connectSaraStream,
  preloadSaraStream,
  releaseSaraStream,
  SARA_STREAM_CAPPED_NOTE,
  setSaraStreamCallbacks,
  setSaraStreamUserMuted,
  settleSaraStreamVoice,
  shouldShowSaraStream,
  speakSaraStream,
  stopSaraStream,
  unlockSaraStream,
} from '../lib/saraStream'
import {
  isSaraMuted,
  isVoiceReady,
  setSaraMuted,
  speakSara,
  stopSaraSpeech,
  unlockSaraSpeech,
} from '../lib/speakSara'
import { nowIso, uid } from '../lib/storage'
import type { ChatMessage } from '../lib/types'

export function AskSara() {
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
  const bottom = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  /** True while D-ID stream audio is the heard voice — do not let a late STOP cancel ara. */
  const streamVoiceRef = useRef(false)
  const fallbackTextRef = useRef<string | null>(null)
  const araPlayingRef = useRef(false)

  const onVideoEl = useCallback((el: HTMLVideoElement | null) => {
    bindSaraStreamVideo(el)
  }, [])

  const onVideoLive = useCallback((live: boolean) => {
    setVideoLive(live)
  }, [])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    setSaraStreamUserMuted(muted)
  }, [muted])

  const playAra = useCallback((text: string) => {
    if (mutedRef.current || !isVoiceReady() || araPlayingRef.current) return
    araPlayingRef.current = true
    streamVoiceRef.current = false
    setVoiceNote(null)
    void speakSara(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => {
        araPlayingRef.current = false
        setSpeaking(false)
      },
      onError: (message) => {
        araPlayingRef.current = false
        setVoiceNote(message)
      },
    })
  }, [])

  useEffect(() => {
    setSaraStreamCallbacks({
      onTalking: (talking) => {
        setStreamTalking(talking)
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
        const text = fallbackTextRef.current
        if (text) playAra(text)
      },
    })
    preloadSaraStream()
    return () => {
      setSaraStreamCallbacks({})
      releaseSaraStream()
      stopSaraSpeech()
    }
  }, [playAra])

  const streaming = shouldShowSaraStream({ streamReady, speaking, streamTalking, videoLive })
  const live = speaking || streamTalking

  const haltPlayback = () => {
    streamVoiceRef.current = false
    araPlayingRef.current = false
    fallbackTextRef.current = null
    stopSaraSpeech()
    stopSaraStream()
    setSpeaking(false)
    setStreamTalking(false)
  }

  const speakReply = (text: string) => {
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
  const greeting = live ? "I'm with you." : listening ? "I'm listening." : "Hey — it's Sara."

  return (
    <main className="ask-sara relative isolate h-dvh max-h-dvh overflow-hidden">
      <div className="ask-sara-stage">
        <TalkingPortrait
          talking={speaking}
          listening={listening}
          streaming={streaming}
          onVideoEl={onVideoEl}
          onVideoLive={onVideoLive}
        />
      </div>

      <div className="ask-sara-overlay relative z-10 flex h-full min-h-0 flex-col">
        <div className="ask-sara-chrome shrink-0 pb-6">
          <header className="flex items-center justify-between px-5 pb-2 safe-top">
            <Link to="/" className="ask-sara-chip text-sm font-medium">
              ← Home
            </Link>
            <p className="ask-sara-chip text-xs font-medium uppercase tracking-[0.18em]">Ask Sara</p>
            <button
              type="button"
              className="ask-sara-chip text-xs font-medium"
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
          <p className="ask-sara-greeting px-5 text-center font-serif text-xl">{greeting}</p>
          <p className="ask-sara-greeting px-5 pt-0.5 text-center text-sm">
            {live ? 'Sara is talking.' : 'I’m listening — ask the real question.'}
          </p>
        </div>

        <div className="ask-sara-mid flex min-h-0 flex-1 flex-col justify-end px-5 pb-2 pt-3">
          {voiceNote ? (
            <p className="ask-sara-note mb-2 text-center text-xs leading-snug">{voiceNote}</p>
          ) : live && streamCapped ? (
            <p className="ask-sara-note mb-2 text-center text-xs leading-snug">{SARA_STREAM_CAPPED_NOTE}</p>
          ) : null}

          <div className="ask-sara-panel min-h-0 space-y-3 overflow-y-auto overscroll-contain">
            {messages.length === 0 ? (
              <p className="text-sm leading-relaxed">
                Try “how much water?”, “why did I leak when I sneezed?”, or “what are symptoms of a
                UTI?”
              </p>
            ) : null}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[90%] text-sm leading-relaxed ${
                  m.from === 'you' ? 'ml-auto text-right font-medium' : ''
                }`}
              >
                {m.text}
                {m.from === 'sara' &&
                m.id === lastSara?.id &&
                isVoiceReady() &&
                !isSaraUnreachable(m.text) ? (
                  <button
                    type="button"
                    className="mt-2 block text-xs font-medium"
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
            {busy ? <div className="text-sm">Listening…</div> : null}
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
            {busy ? 'Sara is thinking…' : 'Send to Sara'}
          </button>
        </form>
      </div>
    </main>
  )
}
