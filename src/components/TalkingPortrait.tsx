import { useEffect, useRef } from 'react'

const STILL = '/avatar/sara-default.png'

type Props = {
  talking: boolean
  listening?: boolean
  streaming?: boolean
  onVideoEl?: (el: HTMLVideoElement | null) => void
}

export function TalkingPortrait({
  talking,
  listening = false,
  streaming = false,
  onVideoEl,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const showStream = Boolean(streaming)

  useEffect(() => {
    onVideoEl?.(videoRef.current)
    return () => onVideoEl?.(null)
  }, [onVideoEl])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const kick = () => {
      video.muted = true
      video.playsInline = true
      void video.play().catch(() => {})
    }
    kick()
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    video.addEventListener('playing', kick)
    return () => {
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
      video.removeEventListener('playing', kick)
    }
  }, [showStream])

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`sara-portrait relative h-40 w-40 bg-sage-mist shadow-card ring-[6px] sm:h-44 sm:w-44 ${
          talking || streaming ? 'ring-sage/45' : 'ring-sage/25'
        }`}
      >
        <video
          ref={videoRef}
          className="sara-stream-video absolute inset-0 z-0 h-full w-full object-cover object-[center_18%]"
          playsInline
          muted
          autoPlay
          loop={false}
          aria-hidden
        />
        <img
          src={STILL}
          alt="Sara"
          className={`absolute inset-0 z-10 h-full w-full object-cover object-[center_18%] ${
            showStream ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>
      <p className="mt-3 min-h-[1.75rem] font-serif text-xl text-ink">
        {talking || streaming ? "I'm with you." : listening ? "I'm listening." : "Hey — it's Sara."}
      </p>
    </div>
  )
}
