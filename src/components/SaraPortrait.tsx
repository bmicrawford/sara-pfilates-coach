import { SARA_PORTRAIT_STILL } from '../lib/saraPortrait'
import type { Mood } from '../lib/types'

const LINES: Record<Mood, string> = {
  default: "Hey — it's Sara.",
  neutral: 'Take your time. No rush.',
  listening: "I'm listening.",
  talking: "I'm with you.",
  celebrate: 'Yes. That counts.',
}

type Props = {
  mood: Mood
  size?: 'hero' | 'compact'
}

export function SaraPortrait({ mood, size = 'hero' }: Props) {
  const box = size === 'hero' ? 'h-56 w-56 sm:h-64 sm:w-64' : 'h-28 w-28'
  const talking = mood === 'talking'

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`relative ${box} overflow-hidden rounded-full bg-sage-mist shadow-card ring-[6px] ${
          talking ? 'sara-talking ring-sage/50' : 'ring-sage/25'
        }`}
      >
        <img
          src={SARA_PORTRAIT_STILL}
          alt="Sara"
          className="absolute inset-0 h-full w-full object-cover object-[center_18%]"
        />
      </div>
      <p className="mt-4 min-h-[2rem] font-serif text-2xl text-ink">{LINES[mood]}</p>
    </div>
  )
}
