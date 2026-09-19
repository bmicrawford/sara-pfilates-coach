import { useCallback, useEffect, useRef } from 'react'
import { isSaraVideoLive, replaySaraStreamVideo } from '../lib/saraStream'

const STILL = '/avatar/sara-default.png'

type Props = {
  talking: boolean
  listening?: boolean
  streaming?: boolean
  onVideoEl?: (el: HTMLVideoElement | null) => void
  onVideoLive?: (live: boolean) => void
}

export function TalkingPortrait({
  talking,
  listening = false,
  streaming = false,
  onVideoEl,
  onVideoLive,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const showStream = Boolean(streaming)

  // Bind during commit so Send/Play connect can attach srcObject before effects run.
  const setVideoNode = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el
      onVideoEl?.(el)
    },
    [onVideoEl],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const kick = () => {
      video.playsInline = true
      video.setAttribute('webkit-playsinline', 'true')
      replaySaraStreamVideo()
    }
    const reportLive = () => {
      onVideoLive?.(isSaraVideoLive(video))
    }
    const reportDead = () => onVideoLive?.(false)
    kick()
    reportLive()
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    video.addEventListener('playing', kick)
    video.addEventListener('playing', reportLive)
    video.addEventListener('loadeddata', reportLive)
    video.addEventListener('emptied', reportDead)
    video.addEventListener('error', reportDead)
    return () => {
      onVideoLive?.(false)
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
      video.removeEventListener('playing', kick)
      video.removeEventListener('playing', reportLive)
      video.removeEventListener('loadeddata', reportLive)
      video.removeEventListener('emptied', reportDead)
      video.removeEventListener('error', reportDead)
    }
  }, [showStream, onVideoLive])

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`sara-portrait relative h-40 w-40 overflow-hidden rounded-full bg-sage-mist shadow-card ring-[6px] sm:h-44 sm:w-44 ${
          talking || streaming ? 'ring-sage/45' : 'ring-sage/25'
        }`}
      >
        <video
          ref={setVideoNode}
          className="sara-stream-video absolute inset-0 z-0 h-full w-full object-cover object-[center_18%]"
          poster={STILL}
          playsInline
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
