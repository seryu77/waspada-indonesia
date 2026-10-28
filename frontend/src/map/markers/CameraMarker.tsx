import { Cctv } from 'lucide-react'
import type { Camera } from '../../types'

export function CameraMarker({ camera }: { camera: Camera }) {
  const online = camera.status === 'online'
  return (
    <div
      role="img"
      aria-label={`CCTV ${camera.name}, ${camera.city}, ${online ? 'online' : 'offline'}, ${camera.detections_today} deteksi hari ini`}
      title={`CCTV ${camera.name} (${online ? 'online' : 'offline'}) - ${camera.detections_today} deteksi hari ini`}
      className="relative flex items-center gap-1 rounded-md border border-white/20 bg-card/95 px-1.5 py-0.5 shadow-md"
    >
      <Cctv size={13} className={online ? 'text-fg' : 'text-muted-fg'} aria-hidden />
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-accent' : 'bg-muted-fg'}`} aria-hidden />
      <span className="font-mono text-[10px] font-semibold text-fg tabular">{camera.detections_today}</span>
    </div>
  )
}
