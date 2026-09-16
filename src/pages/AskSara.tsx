import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Field, inputClass } from '../components/Chip'
import { TalkingPortrait } from '../components/TalkingPortrait'
import { askSaraRemote, isSaraUnreachable } from '../lib/askSara'
import { readChat, writeChat } from '../lib/mockServer'
import {
  isSaraMuted,
  isVoiceReady,
  requestSaraTalk,
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
  const [muted, setMuted] = useState(() => isSaraMuted())
  const [level, setLevel] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const talkFor = useRef<string | null>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => () => stopSaraSpeech(), [])

  const prefetchTalk = (text: string) => {
    if (muted || !isVoiceReady()) return
    if (talkFor.current === text && videoUrl) return
    talkFor.current = text
    void requestSaraTalk(text).then((url) => {
      if (url && talkFor.current === text) setVideoUrl(url)
    })
  }

  const speakReply = (text: string) => {
    if (muted || !isVoiceReady()) return
    setVoiceNote(null)
    setLevel(0)
    void speakSara(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => {
        setSpeaking(false)
        setLevel(0)
      },
      onLevel: setLevel,
      onError: (message) => setVoiceNote(message),
    })
    prefetchTalk(text)
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    unlockSaraSpeech()
    stopSaraSpeech()
    setSpeaking(false)
    setLevel(0)
    setVideoUrl(null)
    talkFor.current = null
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
            if (speaking && !muted) {
              stopSaraSpeech()
              setSpeaking(false)
              setLevel(0)
              return
            }
            const next = !muted
            setMuted(next)
            setSaraMuted(next)
            if (next) {
              setSpeaking(false)
              setLevel(0)
            }
          }}
        >
          {muted ? 'Unmute' : speaking ? 'Stop' : 'Mute'}
        </button>
      </header>

      <div className="ask-sara-stage shrink-0 bg-cream pb-2 pt-2">
        <TalkingPortrait
          talking={speaking}
          listening={busy || Boolean(draft.trim())}
          level={level}
          videoUrl={videoUrl}
        />
        <p className="mt-1 text-center text-sm text-ink-mute">
          {speaking ? 'Sara is talking.' : 'I’m listening — ask the real question.'}
        </p>
        {voiceNote ? (
          <p className="mt-1 text-center text-xs leading-snug text-ink-mute">{voiceNote}</p>
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
                  unlockSaraSpeech()
                  if (speaking) {
                    stopSaraSpeech()
                    setSpeaking(false)
                    setLevel(0)
                    return
                  }
                  speakReply(m.text)
                }}
              >
                {speaking ? 'Stop' : 'Play'}
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
