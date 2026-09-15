const MUTE_KEY = 'sara.voiceMuted'

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function isSaraMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSaraMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (muted) stopSaraSpeech()
}

export function stopSaraSpeech(): void {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
}

/** Call from a tap (Send). iOS Safari only unlocks TTS inside a user gesture. */
export function unlockSaraSpeech(): void {
  if (!isSpeechSupported()) return
  try {
    window.speechSynthesis.cancel()
    const warm = new SpeechSynthesisUtterance(' ')
    warm.volume = 0
    warm.rate = 1
    window.speechSynthesis.speak(warm)
    window.speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const en = voices.filter((v) => /^en\b/i.test(v.lang))
  const pool = en.length ? en : voices
  const prefer = /samantha|karen|moira|tessa|susan|fiona|victoria|allison|ava|zoe|siri|female|woman/i
  return pool.find((v) => prefer.test(v.name)) ?? pool.find((v) => /google uk english female/i.test(v.name)) ?? pool[0] ?? null
}

function chunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean)
  const out: string[] = []
  let buf = ''
  for (const p of parts) {
    if ((buf + ' ' + p).trim().length > 220) {
      if (buf) out.push(buf)
      buf = p
    } else {
      buf = buf ? `${buf} ${p}` : p
    }
  }
  if (buf) out.push(buf)
  return out
}

type SpeakOpts = {
  onStart?: () => void
  onEnd?: () => void
}

export function speakSara(text: string, opts: SpeakOpts = {}): void {
  if (!isSpeechSupported() || isSaraMuted()) {
    opts.onEnd?.()
    return
  }
  const pieces = chunks(text)
  if (!pieces.length) {
    opts.onEnd?.()
    return
  }

  window.speechSynthesis.cancel()
  let started = false
  let index = 0

  const speakNext = () => {
    if (index >= pieces.length) {
      opts.onEnd?.()
      return
    }
    const u = new SpeechSynthesisUtterance(pieces[index])
    u.lang = 'en-US'
    const voice = pickVoice()
    if (voice) u.voice = voice
    u.rate = 0.96
    u.pitch = 1.02
    u.onstart = () => {
      if (!started) {
        started = true
        opts.onStart?.()
      }
    }
    u.onend = () => {
      index += 1
      speakNext()
    }
    u.onerror = () => {
      opts.onEnd?.()
    }
    window.speechSynthesis.speak(u)
  }

  const kick = () => speakNext()
  if (!window.speechSynthesis.getVoices().length) {
    window.speechSynthesis.addEventListener('voiceschanged', kick, { once: true })
    window.setTimeout(kick, 250)
  } else {
    kick()
  }
}
