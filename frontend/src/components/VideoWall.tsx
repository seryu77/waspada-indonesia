import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Crosshair, ExternalLink, MonitorPlay, X } from 'lucide-react'
import type { Camera } from '../types'
import { CameraPlayer } from './CameraPlayer'
import { hasStream, isPortal } from '../lib/camera'

interface Props {
  cameras: Camera[]
  onClose: () => void
  /** Tutup wall, buka kamera di peta */
  onLocate: (id: string) => void
}

// 6 video sekaligus: lebih dari itu, decoding video dan koneksi ke server pemda jadi berat
const PAGE = 6

/** Ruang kontrol: grid semua kamera yang punya siaran, dikelompokkan per kota. */
export function VideoWall({ cameras, onClose, onLocate }: Props) {
  const live = useMemo(() => cameras.filter(hasStream).sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name)), [cameras])
  const cities = useMemo(() => [...new Set(live.map((c) => c.city))], [live])
  const portals = useMemo(() => cameras.filter(isPortal).sort((a, b) => a.city.localeCompare(b.city)), [cameras])
  const [city, setCity] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const shown = city ? live.filter((c) => c.city === city) : live
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const tiles = shown.slice(page * PAGE, page * PAGE + PAGE)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chip = (label: string, value: string | null) => (
    <button
      key={label}
      type="button"
      aria-pressed={city === value}
      onClick={() => {
        setCity(value)
        setPage(0)
      }}
      className={`h-8 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${
        city === value ? 'border-fg text-fg' : 'border-line-strong text-dim hover:border-fg hover:text-fg'
      }`}
    >
      {label}
    </button>
  )

  return (
    <motion.section
      aria-label="Video wall CCTV"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      // Latar solid: blur di belakang video ikut dihitung ulang tiap frame video berganti
      className="pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0B0E13]"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <MonitorPlay size={18} className="text-dim" aria-hidden />
        <h2 className="sign text-[14px]">Video wall</h2>
        <span className="text-xs text-muted-fg tabular">
          {live.length} kamera live dari {new Set(live.map((c) => c.source)).size} sumber resmi
        </span>
        <div className="ml-2 flex flex-wrap gap-1.5">
          {chip('Semua', null)}
          {cities.map((c) => chip(c, c))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {pages > 1 && (
            <span className="flex items-center gap-1 text-xs text-dim tabular">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40">
                Sebelumnya
              </button>
              {page + 1}/{pages}
              <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40">
                Berikutnya
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup video wall"
            className="grid h-8 w-8 place-items-center rounded-lg text-dim transition-colors hover:bg-white/10 hover:text-fg"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      {portals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
          <span className="sign mr-1 text-[11px] text-muted-fg">Portal CCTV resmi lainnya</span>
          {portals.map((c) => (
            <a
              key={c.id}
              href={c.stream_url}
              target="_blank"
              rel="noreferrer"
              title={c.source}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong px-2 text-[12px] text-dim transition-colors hover:border-fg hover:text-fg"
            >
              {c.city} <ExternalLink size={11} aria-hidden />
            </a>
          ))}
        </div>
      )}
      {live.length === 0 ? (
        <p className="grid flex-1 place-items-center text-sm text-dim">Belum ada kamera dengan siaran langsung.</p>
      ) : (
        <ul className="scroll-thin grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
          {tiles.map((c) => (
            <li key={c.id} className="overflow-hidden rounded-xl border border-line bg-black/30">
              <CameraPlayer camera={c} compact />
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{c.name}</p>
                  <p className="truncate text-[11px] text-muted-fg">{c.city}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onLocate(c.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-dim transition-colors hover:bg-white/10 hover:text-fg"
                >
                  <Crosshair size={13} aria-hidden /> Lihat di peta
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  )
}
