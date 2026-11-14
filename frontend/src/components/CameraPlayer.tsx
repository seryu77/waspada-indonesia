import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader, VideoOff } from 'lucide-react'
import type { Camera } from '../types'
import { youtubeId } from '../lib/camera'

interface Props {
  camera: Camera
  /** Tampilan kecil untuk video wall: teks lebih ringkas */
  compact?: boolean
}

/**
 * Stream CCTV langsung:
 * - youtube: embed siaran publik resmi (misal Dishub), tanpa cookie
 * - embed: player resmi milik pemda (misal datarhei Restreamer) lewat iframe
 * - portal: portal CCTV resmi yang tidak bisa di-embed, tampil sebagai tombol buka portal
 * - hls: hls.js, atau native di Safari
 * - snapshot: gambar JPG yang di-refresh tiap 5 detik
 * - rtsp/none: tidak bisa diputar di browser
 */
export function CameraPlayer({ camera, compact = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'loading' | 'playing' | 'error'>('loading')
  const [tick, setTick] = useState(0)

  // Komponen diberi key per kamera oleh induknya, jadi state awal selalu 'loading'
  useEffect(() => {
    if (camera.stream_type === 'snapshot') {
      const t = window.setInterval(() => setTick((n) => n + 1), 5000)
      return () => window.clearInterval(t)
    }
    if (camera.stream_type !== 'hls') return
    const video = videoRef.current
    if (!video) return
    let hls: { destroy: () => void } | null = null
    let disposed = false
    const onPlaying = () => setState('playing')
    const onError = () => setState('error')
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)
    // Utamakan hls.js. Chrome versi baru juga menjawab "maybe" untuk HLS bawaan, tapi pemutar bawaannya
    // gagal di server pemda yang memakai redirect cookieCheck (misal Banjarbaru). Pemutar bawaan hanya
    // dipakai kalau hls.js tidak didukung (Safari iOS, yang memang memutar HLS secara native).
    const native = () => {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = camera.stream_url
      else setState('error')
    }
    void import('hls.js')
      .then(({ default: Hls }) => {
        if (disposed) return
        if (!Hls.isSupported()) return native()
        const h = new Hls({ liveDurationInfinity: true })
        h.on(Hls.Events.ERROR, (_e, data) => data.fatal && setState('error'))
        h.loadSource(camera.stream_url)
        h.attachMedia(video)
        hls = h
      })
      .catch(() => !disposed && native())
    return () => {
      disposed = true
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
      hls?.destroy()
      video.removeAttribute('src')
    }
  }, [camera.stream_url, camera.stream_type])

  const fail = (msg: string) => (
    <div className="grid aspect-video w-full place-items-center rounded-lg bg-raised px-4 text-center">
      <div>
        <VideoOff size={compact ? 18 : 22} className="mx-auto text-muted-fg" aria-hidden />
        <p className={`mt-1.5 text-dim ${compact ? 'text-[12px]' : 'text-[13px]'}`}>{msg}</p>
        {!compact && <p className="mt-0.5 text-[11px] text-muted-fg">Gunakan frame bukti, atau buka lewat VMS/ATCS pemda.</p>}
      </div>
    </div>
  )

  if (camera.stream_type === 'none' || !camera.stream_url) return fail('Kamera demo, belum tersambung ke stream asli.')

  if (camera.stream_type === 'portal') {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-lg bg-raised px-4 text-center">
        <div>
          <p className={`text-dim ${compact ? 'text-[12px]' : 'text-[13px]'}`}>CCTV daerah ini hanya bisa ditonton di portal resmi instansi.</p>
          <a
            href={camera.stream_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-fg transition-colors hover:border-fg"
          >
            Buka portal resmi <ExternalLink size={14} aria-hidden />
          </a>
        </div>
      </div>
    )
  }

  if (camera.stream_type === 'embed') {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe
          src={camera.stream_url}
          title={`Siaran langsung CCTV ${camera.name}`}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
    )
  }
  if (camera.stream_type === 'rtsp') return fail('Stream RTSP tidak bisa diputar langsung di browser.')
  if (state === 'error' || camera.status === 'offline') return fail('Stream kamera tidak bisa dibuka saat ini.')

  if (camera.stream_type === 'youtube') {
    const id = youtubeId(camera.stream_url)
    if (!id) return fail('Alamat siaran YouTube tidak valid.')
    const q = new URLSearchParams({ autoplay: '1', mute: '1', playsinline: '1', rel: '0', controls: compact ? '0' : '1' })
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?${q}`}
          title={`Siaran langsung CCTV ${camera.name}`}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
    )
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      {camera.stream_type === 'snapshot' ? (
        <img
          src={`${camera.stream_url}${camera.stream_url.includes('?') ? '&' : '?'}t=${tick}`}
          alt={`Gambar terbaru CCTV ${camera.name}`}
          className="h-full w-full object-cover"
          onLoad={() => setState('playing')}
          onError={() => setState('error')}
        />
      ) : (
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay aria-label={`Siaran langsung CCTV ${camera.name}`} />
      )}
      {state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-dim">
          <span className="inline-flex items-center gap-2">
            <Loader size={14} className="animate-spin" aria-hidden /> Menyambung ke kamera
          </span>
        </div>
      )}
      {state === 'playing' && (
        <span className="sign absolute left-2 top-2 inline-flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-sev-critical">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sev-critical" aria-hidden /> Live
        </span>
      )}
    </div>
  )
}
