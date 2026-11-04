import { memo } from 'react'
import { Cctv } from 'lucide-react'
import type { Camera } from '../../types'
import { hasStream, isPortal } from '../../lib/camera'

interface Props {
  camera: Camera
  selected: boolean
  onSelect: (id: string) => void
}

/** Latar solid, bukan efek kaca: backdrop-filter di ratusan marker membuat peta patah-patah saat digeser. */
export const CameraMarker = memo(function CameraMarker({ camera, selected, onSelect }: Props) {
  const online = camera.status === 'online'
  const live = hasStream(camera)
  const portal = isPortal(camera)
  const label = portal
    ? `${camera.name}: buka portal CCTV resmi`
    : `CCTV ${camera.name}, ${camera.city}, ${online ? 'online' : 'offline'}${live ? ', siaran langsung' : ''}. ${camera.detections_today} deteksi hari ini`
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect(camera.id)
      }}
      aria-label={label}
      aria-pressed={selected}
      title={portal ? camera.name : `CCTV ${camera.name}${live ? ' (live)' : ''}`}
      className={`flex h-5 items-center gap-1 rounded-md border border-white/15 bg-[#10141B] pl-1 pr-1.5 shadow-[0_2px_6px_rgb(0_0_0/0.5)] transition-colors hover:border-white/60 ${selected ? 'ring-2 ring-white' : ''}`}
    >
      <Cctv size={12} className={online ? 'text-fg' : 'text-muted-fg'} aria-hidden />
      <span className="h-1.5 w-1.5" style={{ background: !online ? '#5B626C' : portal ? '#60A5FA' : live ? '#F2555A' : '#3CCF7E' }} aria-hidden />
      <span className="text-[11px] font-semibold leading-none text-fg tabular">{portal ? 'PORTAL' : live ? 'LIVE' : camera.detections_today}</span>
    </button>
  )
})
