import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Map as MapIcon, Megaphone, Phone, TriangleAlert } from 'lucide-react'
import type { Connection } from '../types'
import { clockWIB } from '../lib/format'

interface Props {
  connection: Connection
  lastUpdate: number | null
  stats: { active: number; critical: number; dispatched: number; review: number }
  onReport: () => void
  operator: boolean
}

const STATUS: Record<Connection, { label: string; short?: string; color: string }> = {
  live: { label: 'Live', color: '#3CCF7E' },
  stale: { label: 'Basi', color: '#EAB308' },
  offline: { label: 'Offline', color: '#F2555A' },
  connecting: { label: 'Menyambung', short: 'Sambung', color: '#929AA4' },
}

function LiveIndicator({ connection, lastUpdate }: Pick<Props, 'connection' | 'lastUpdate'>) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = STATUS[connection]
  return (
    <div className="flex items-center gap-2.5" role="status" aria-live="polite">
      <span className="relative flex h-2 w-2" aria-hidden>
        {connection === 'live' && (
          <motion.span
            className="absolute inset-0"
            style={{ background: s.color }}
            animate={{ opacity: [0.8, 0], scale: [1, 2.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <span className="relative h-2 w-2" style={{ background: s.color }} />
      </span>
      <span className="sign whitespace-nowrap text-[13px]" style={{ color: s.color }}>
        {s.short ? (
          <>
            <span className="min-[420px]:hidden">{s.short}</span>
            <span className="hidden min-[420px]:inline">{s.label}</span>
          </>
        ) : (
          s.label
        )}
      </span>
      <span className="hidden text-xs text-muted-fg tabular sm:inline">{lastUpdate ? clockWIB(lastUpdate) : 'menunggu server'}</span>
    </div>
  )
}

/** Angka berganti dengan geser vertikal singkat: tanda data baru masuk, bukan dekorasi. */
function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex h-full flex-col justify-center border-l border-line px-4">
      <span className="relative h-6 overflow-hidden font-display text-[22px] font-semibold leading-6 tabular" style={{ color }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            className="block"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%', transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="sign text-[11px] text-muted-fg">{label}</span>
    </div>
  )
}

export function TopBar({ connection, lastUpdate, stats, onReport, operator }: Props) {
  return (
    <header className="pointer-events-auto glass flex h-13 shrink-0 items-stretch overflow-hidden rounded-2xl">
      <div className="flex shrink-0 items-center gap-2 px-2.5 sm:gap-2.5 md:px-4">
        <span className="grid h-7 w-7 place-items-center bg-danger text-white" aria-hidden>
          <TriangleAlert size={16} strokeWidth={2.5} />
        </span>
        <h1 className="whitespace-nowrap font-display text-[17px] font-bold uppercase leading-none tracking-wide sm:text-[19px]">
          Waspada <span className="hidden font-semibold text-muted-fg min-[400px]:inline">{operator ? 'Operator 112' : 'Nusantara'}</span>
        </h1>
      </div>

      <div className="flex min-w-0 items-center border-l border-line px-2.5 md:px-4">
        <LiveIndicator connection={connection} lastUpdate={lastUpdate} />
      </div>

      <div className="hidden lg:flex" aria-label="Ringkasan statistik">
        <Stat label="Kejadian aktif" value={stats.active} />
        <Stat label="Kritis" value={stats.critical} color="#F2555A" />
        {operator && <Stat label="Butuh validasi" value={stats.review} color="#EAB308" />}
        <Stat label="Petugas dikirim" value={stats.dispatched} color="#3CCF7E" />
        <span className="border-l border-line" aria-hidden />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 px-2 md:px-3">
        {operator ? (
          <a
            href="/"
            className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-dim transition-colors duration-150 hover:border-fg hover:text-fg"
          >
            <MapIcon size={16} aria-hidden />
            <span className="hidden sm:inline">Peta publik</span>
          </a>
        ) : (
          <>
            <button
              type="button"
              onClick={onReport}
              className="hidden h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-dim transition-colors duration-150 hover:border-fg hover:text-fg sm:flex"
            >
              <Megaphone size={16} aria-hidden />
              Lapor kejadian
            </button>
            <a
              href="tel:112"
              className="flex h-9 items-center gap-2 rounded-lg bg-alarm px-3 text-white transition-colors duration-150 hover:bg-alarm-hover"
              aria-label="Hubungi 112, layanan darurat"
            >
              <Phone size={16} aria-hidden />
              <span className="font-display text-lg font-bold leading-none tabular">112</span>
              <span className="sign hidden text-[13px] sm:inline">Darurat</span>
            </a>
          </>
        )}
      </div>
    </header>
  )
}
