import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Field, inputClass } from '../components/Chip'
import { SaraPortrait } from '../components/SaraPortrait'
import { readChat, writeChat } from '../lib/mockServer'
import { askShouldCelebrate, replyAsSara } from '../lib/replies'
import { nowIso, uid } from '../lib/storage'
import type { ChatMessage, Mood } from '../lib/types'

export function AskSara() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChat())
  const [draft, setDraft] = useState('')
  const [mood, setMood] = useState<Mood>('default')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setMood(draft.trim() ? 'listening' : 'default')
  }, [draft])

  const send = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    const you: ChatMessage = { id: uid(), from: 'you', text, at: nowIso() }
    const sara: ChatMessage = {
      id: uid(),
      from: 'sara',
      text: replyAsSara(text, messages),
      at: nowIso(),
    }
    const next = [...messages, you, sara]
    setMessages(next)
    writeChat(next)
    setDraft('')
    setMood(askShouldCelebrate(text, messages) ? 'celebrate' : 'default')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-5 pb-6 safe-top">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-sm text-sage-deep">
          ← Home
        </Link>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-faint">Ask Sara</p>
        <span className="w-10" />
      </header>

      <div className="mt-6">
        <SaraPortrait mood={mood} size="compact" />
        <p className="mt-2 text-center text-sm text-ink-mute">
          Ask a real question — I’ll answer that, not a pep talk.
        </p>
      </div>

      <div className="mt-6 flex-1 space-y-3">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-cream-card px-4 py-3 text-sm text-ink-mute shadow-card">
            Try “how much water?”, “why did I leak when I sneezed?”, or “is coffee ok?”
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
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className="mt-4 space-y-3">
        <Field label="Your note">
          <textarea
            className={`${inputClass} min-h-[5.5rem] resize-none`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What’s going on?"
          />
        </Field>
        <button
          type="submit"
          className="w-full rounded-full bg-sage py-3 font-semibold text-white disabled:opacity-40"
          disabled={!draft.trim()}
        >
          Send to Sara
        </button>
      </form>
    </main>
  )
}
