import { useEffect, useRef } from 'react'

const STILL = '/avatar/sara-default.png'

type Props = {
  talking: boolean
  listening?: boolean
  level: number
  videoUrl?: string | null
}

function coverDraw(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: number,
) {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) return { destX: 0, destY: 0, dw: size, dh: size }
  const scale = Math.max(size / iw, size / ih)
  const dw = iw * scale
  const dh = ih * scale
  const destX = (size - dw) / 2
  const destY = size * 0.5 - dh * 0.18
  ctx.drawImage(img, destX, destY, dw, dh)
  return { destX, destY, dw, dh }
}

function paintHead(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  open: number,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const css = canvas.clientWidth || 176
  if (canvas.width !== Math.round(css * dpr) || canvas.height !== Math.round(css * dpr)) {
    canvas.width = Math.round(css * dpr)
    canvas.height = Math.round(css * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.width
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.clip()
  const placed = coverDraw(ctx, img, size)

  if (open > 0.03) {
    const mx = size * 0.5
    const my = size * 0.665
    const rx = size * (0.078 + open * 0.018)
    const ry = size * (0.014 + open * 0.052)

    ctx.save()
    ctx.beginPath()
    ctx.ellipse(mx, my, rx * 1.45, ry * 2.4, 0, 0, Math.PI * 2)
    ctx.clip()
    ctx.translate(mx, my + ry * 0.15)
    ctx.scale(1 + open * 0.04, 1 + open * 0.62)
    ctx.translate(-mx, -(my + ry * 0.15))
    ctx.drawImage(img, placed.destX, placed.destY, placed.dw, placed.dh)
    ctx.restore()

    const cavity = ctx.createRadialGradient(mx, my + ry * 0.2, 0, mx, my, rx)
    cavity.addColorStop(0, `rgba(52, 18, 20, ${0.12 + open * 0.58})`)
    cavity.addColorStop(0.65, `rgba(92, 38, 42, ${0.06 + open * 0.28})`)
    cavity.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = cavity
    ctx.beginPath()
    ctx.ellipse(mx, my + ry * 0.12, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()

    if (open > 0.22) {
      ctx.fillStyle = `rgba(255, 252, 248, ${(open - 0.22) * 0.5})`
      ctx.beginPath()
      ctx.ellipse(mx, my - ry * 0.38, rx * 0.7, ry * 0.26, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function TalkingPortrait({ talking, listening = false, level, videoUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const openRef = useRef(0)
  const showVideo = Boolean(talking && videoUrl)
  openRef.current = talking ? Math.min(1, Math.max(0, level)) : 0

  useEffect(() => {
    const img = new Image()
    img.src = STILL
    img.onload = () => {
      imgRef.current = img
      const canvas = canvasRef.current
      if (canvas) paintHead(canvas, img, openRef.current)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    paintHead(canvas, img, talking ? Math.min(1, Math.max(0, level)) : 0)
  }, [talking, level])

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
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full ${showVideo ? 'opacity-0' : 'opacity-100'}`}
          aria-hidden
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
