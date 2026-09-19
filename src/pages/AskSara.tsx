import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Field, inputClass } from '../components/Chip'
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

  return (
    <main className="ask-sara mx-auto flex h-dvh max-h-dvh max-w-[430px] flex-col overflow-hidden px-5 safe-top">
      <header className="flex shrink-0 items-center justify-between pb-1">
        <Link to="/" className="text-sm text-sage-deep">
          ← Home
        </Link>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-faint">Ask Sara</p>
        <button
          type="button"
          className="text-xs text-sage-deep"
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

      <div className="ask-sara-stage shrink-0 bg-cream pb-2 pt-2">
        <TalkingPortrait
          talking={speaking}
          listening={busy || Boolean(draft.trim())}
          streaming={streaming}
          onVideoEl={onVideoEl}
          onVideoLive={onVideoLive}
        />
        <p className="mt-1 text-center text-sm text-ink-mute">
          {live ? 'Sara is talking.' : 'I’m listening — ask the real question.'}
        </p>
        {voiceNote ? (
          <p className="mt-1 text-center text-xs leading-snug text-ink-mute">{voiceNote}</p>
        ) : live && streamCapped ? (
          <p className="mt-1 text-center text-xs leading-snug text-ink-mute">{SARA_STREAM_CAPPED_NOTE}</p>
        ) : null}
      </div>

      <div className="ask-sara-thread min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-cream-card px-4 py-3 text-sm text-ink-mute shadow-card">
            Try “how much water?”, “why did I leak when I sneezed?”, or “what are symptoms of a UTI?”
          </p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.from === 'you'
                ? 'ml-auto bg-sage text-white'
                : 'bg-cream-card text-ink shadow-card'
            }`}
          >
            {m.text}
            {m.from === 'sara' &&
            m.id === lastSara?.id &&
            isVoiceReady() &&
            !isSaraUnreachable(m.text) ? (
              <button
                type="button"
                className="mt-2 block text-xs font-medium text-sage-deep"
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
          <div className="max-w-[85%] rounded-2xl bg-cream-card px-4 py-3 text-sm text-ink-mute shadow-card">
            Listening…
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="ask-sara-compose shrink-0 space-y-3 bg-cream pb-4 pt-2 safe-bottom">
        <Field label="Your note">
          <textarea
            className={`${inputClass} min-h-[4.5rem] resize-none`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What’s going on?"
            disabled={busy}
          />
        </Field>
        <button
          type="submit"
          className="w-full rounded-full bg-sage py-3 font-semibold text-white disabled:opacity-40"
          disabled={!draft.trim() || busy}
        >
          {busy ? 'Sara is thinking…' : 'Send to Sara'}
        </button>
      </form>
    </main>
  )
}
