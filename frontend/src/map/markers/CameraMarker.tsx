import { Cctv } from 'lucide-react'
import type { Camera } from '../../types'

export function CameraMarker({ camera }: { camera: Camera }) {
  const online = camera.status === 'online'
  return (
    <div
      role="img"
      aria-label={`CCTV ${camera.name}, ${camera.city}, ${online ? 'online' : 'offline'}, ${camera.detections_today} deteksi hari ini`}
      title={`CCTV ${camera.name} (${online ? 'online' : 'offline'}), ${camera.detections_today} deteksi hari ini`}
      className="flex h-5 items-center gap-1 border border-line-strong bg-panel pl-1 pr-1.5"
    >
      <Cctv size={12} className={online ? 'text-fg' : 'text-muted-fg'} aria-hidden />
      <span className="h-1.5 w-1.5" style={{ background: online ? '#3CCF7E' : '#5B626C' }} aria-hidden />
      <span className="text-[11px] font-semibold leading-none text-fg tabular">{camera.detections_today}</span>
    </div>
  )
}
