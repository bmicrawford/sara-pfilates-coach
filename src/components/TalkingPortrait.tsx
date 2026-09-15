import { useEffect, useRef } from 'react'

const STILL = '/avatar/sara-default.png'

type Props = {
  talking: boolean
  listening?: boolean
  level: number
  videoUrl?: string | null
}

export function TalkingPortrait({ talking, listening = false, level, videoUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const showVideo = Boolean(talking && videoUrl)
  const open = talking ? Math.min(1, Math.max(0, level)) : 0

  useEffect(() => {
    const video = videoRef.current
    if (!video || !showVideo || !videoUrl) return
    video.src = videoUrl
    video.muted = true
    void video.play().catch(() => {})
    return () => {
      video.pause()
    }
  }, [showVideo, videoUrl])

  const left = 44.8 - open * 0.55
  const right = 55.2 + open * 0.55
  const top = 43.75 - open * 0.95
  const bot = 45.15 + open * 3.85
  const mid = 50
  const mouth = `M ${left} 44.05 C ${left + 3} ${top}, ${right - 3} ${top}, ${right} 44.05 C ${right - 2.2} ${bot}, ${left + 2.2} ${bot}, ${left} 44.05 Z`
  const teeth = `M ${left + 1.6} 44.15 C ${mid - 4} ${top + 0.35}, ${mid + 4} ${top + 0.35}, ${right - 1.6} 44.15 C ${mid + 3} ${top + 1.35 + open}, ${mid - 3} ${top + 1.35 + open}, ${left + 1.6} 44.15 Z`

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`relative h-40 w-40 overflow-hidden rounded-full bg-sage-mist shadow-card ring-[6px] sm:h-44 sm:w-44 ${
          talking ? 'ring-sage/45' : 'ring-sage/25'
        }`}
      >
        <img
          src={STILL}
          alt="Sara"
          className={`absolute inset-0 h-full w-full object-cover object-[center_18%] ${
            showVideo ? 'opacity-0' : 'opacity-100'
          }`}
        />
        <svg
          className={`pointer-events-none absolute inset-0 h-full w-full ${showVideo ? 'opacity-0' : 'opacity-100'}`}
          viewBox="0 0 100 100"
          aria-hidden
        >
          <g style={{ opacity: open > 0.05 ? Math.min(1, open * 1.15) : 0 }}>
            <path d={mouth} fill={`rgba(62, 22, 24, ${0.42 + open * 0.38})`} />
            <path d={teeth} fill={`rgba(255, 251, 246, ${open > 0.18 ? Math.min(0.7, (open - 0.12) * 0.85) : 0})`} />
            <path
              d={`M ${left + 1} ${44.2 + open * 2.4} C ${mid - 3} ${bot - 0.35}, ${mid + 3} ${bot - 0.35}, ${right - 1} ${44.2 + open * 2.4}`}
              fill="none"
              stroke={`rgba(120, 48, 52, ${0.25 + open * 0.35})`}
              strokeWidth={0.45 + open * 0.25}
              strokeLinecap="round"
            />
          </g>
        </svg>
        {videoUrl ? (
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover object-[center_18%] ${
              showVideo ? 'opacity-100' : 'opacity-0'
            }`}
            playsInline
            muted
            loop={false}
            aria-hidden
          />
        ) : null}
      </div>
      <p className="mt-3 min-h-[1.75rem] font-serif text-xl text-ink">
        {talking ? "I'm with you." : listening ? "I'm listening." : "Hey — it's Sara."}
      </p>
    </div>
  )
}
