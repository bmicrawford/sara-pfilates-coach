import { useEffect, useRef } from 'react'

const STILL = '/avatar/sara-default.png'

type Props = {
  talking: boolean
  listening?: boolean
  videoUrl?: string | null
}

export function TalkingPortrait({ talking, listening = false, videoUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const showVideo = Boolean(talking && videoUrl)

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
