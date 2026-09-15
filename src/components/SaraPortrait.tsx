import type { Mood } from '../lib/types'

const AVATARS: Record<Mood, string> = {
  default: '/avatar/sara-default.png',
  neutral: '/avatar/sara-neutral.png',
  listening: '/avatar/sara-listening.png',
  talking: '/avatar/sara-listening.png',
  celebrate: '/avatar/sara-celebrate.png',
}

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
        {(Object.keys(AVATARS) as Mood[]).map((key) => {
          const shown = key === (mood === 'talking' ? 'talking' : mood)
          return (
            <img
              key={key}
              src={AVATARS[key]}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover object-[center_18%] transition-opacity duration-500 ${
                shown ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )
        })}
      </div>
      <p className="mt-4 min-h-[2rem] font-serif text-2xl text-ink">{LINES[mood]}</p>
    </div>
  )
}
