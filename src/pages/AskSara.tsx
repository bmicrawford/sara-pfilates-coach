import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Field, inputClass } from '../components/Chip'
import { SaraPortrait } from '../components/SaraPortrait'
import { askSaraRemote } from '../lib/askSara'
import { readChat, writeChat } from '../lib/mockServer'
import {
  isSaraMuted,
  isSpeechSupported,
  setSaraMuted,
  speakSara,
  stopSaraSpeech,
  unlockSaraSpeech,
} from '../lib/speakSara'
import { nowIso, uid } from '../lib/storage'
import type { ChatMessage, Mood } from '../lib/types'

export function AskSara() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat())
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(() => isSaraMuted())
  const bottom = useRef<HTMLDivElement>(null)

  const mood: Mood = busy ? 'listening' : speaking ? 'talking' : draft.trim() ? 'listening' : 'default'

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => () => stopSaraSpeech(), [])

  const speakReply = (text: string) => {
    if (muted || !isSpeechSupported()) return
    speakSara(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    })
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    unlockSaraSpeech()
    stopSaraSpeech()
    setSpeaking(false)
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
    speakReply(reply)
  }

  const lastSara = [...messages].reverse().find((m) => m.from === 'sara')

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-6 safe-top">
      <header className="flex items-center justify-between">
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
              return
            }
            const next = !muted
            setMuted(next)
            setSaraMuted(next)
            if (next) setSpeaking(false)
          }}
        >
          {muted ? 'Unmute' : speaking ? 'Stop' : 'Mute'}
        </button>
      </header>

      <div className="mt-6">
        <SaraPortrait mood={mood} size="compact" />
        <p className="mt-2 text-center text-sm text-ink-mute">
          {speaking ? 'Sara is talking.' : 'I’m listening — ask the real question.'}
        </p>
      </div>

      <div className="mt-6 flex-1 space-y-3">
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
            {m.from === 'sara' && m.id === lastSara?.id && isSpeechSupported() ? (
              <button
                type="button"
                className="mt-2 block text-xs font-medium text-sage-deep"
                onClick={() => {
                  unlockSaraSpeech()
                  if (speaking) {
                    stopSaraSpeech()
                    setSpeaking(false)
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

      <form onSubmit={send} className="mt-4 space-y-3">
        <Field label="Your note">
          <textarea
            className={`${inputClass} min-h-[5.5rem] resize-none`}
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
