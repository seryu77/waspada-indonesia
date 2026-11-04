import { useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { Cctv, ExternalLink, X } from 'lucide-react'
import type { Camera, Incident } from '../types'
import { HAZARDS, SEVERITY } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { CameraPlayer } from './CameraPlayer'

interface Props {
  camera: Camera
  incidents: Incident[]
  onClose: () => void
  onSelectIncident: (id: string) => void
}

const NEARBY_KM = 10

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

/** Panel kaca melayang: siaran langsung satu kamera plus kejadian aktif di sekitarnya. */
export function CameraViewer({ camera, incidents, onClose, onSelectIncident }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const nearby = useMemo(
    () =>
      incidents
        .map((i) => ({ i, km: distanceKm(camera, i) }))
        .filter((x) => x.km <= NEARBY_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, 3),
    [camera, incidents],
  )

  return (
    <motion.section
      aria-label={`CCTV ${camera.name}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="glass-strong pointer-events-auto w-full overflow-hidden rounded-2xl"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Cctv size={16} className="shrink-0 text-dim" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{camera.name}</h2>
          <p className="truncate text-[12px] text-muted-fg">{camera.city}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup CCTV"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-white/10 hover:text-fg"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="p-2">
        <CameraPlayer key={camera.id} camera={camera} />
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-muted-fg">
        <span className="min-w-0 flex-1 truncate" title={camera.source}>
          {camera.source ? `Sumber: ${camera.source}` : 'Kamera demo'}
          {camera.approx_location && ', lokasi di peta perkiraan'}
        </span>
        {camera.stream_type === 'youtube' && (
          <a
            href={camera.stream_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-dim underline-offset-2 hover:text-fg hover:underline"
          >
            Buka di YouTube <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>

      {nearby.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <h3 className="sign mb-1 text-[11px] text-muted-fg">Kejadian aktif dalam {NEARBY_KM} km</h3>
          <ul className="space-y-0.5">
            {nearby.map(({ i, km }) => {
              const sev = SEVERITY[effectiveSeverity(i)]
              const Icon = HAZARDS[i.type].Icon
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onSelectIncident(i.id)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-white/10"
                  >
                    <Icon size={14} style={{ color: HAZARDS[i.type].color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="shrink-0 text-[11px] tabular" style={{ color: sev.color }}>
                      {km.toFixed(1).replace('.', ',')} km
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </motion.section>
  )
}
