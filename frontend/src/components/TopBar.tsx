import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Megaphone, Phone, TriangleAlert } from 'lucide-react'
import type { Connection } from '../types'
import { clockWIB } from '../lib/format'

interface Props {
  connection: Connection
  lastUpdate: number | null
  stats: { active: number; critical: number; dispatched: number }
  onReport: () => void
}

const STATUS: Record<Connection, { label: string; dot: string; text: string }> = {
  live: { label: 'LIVE', dot: 'bg-accent', text: 'text-accent' },
  stale: { label: 'BASI', dot: 'bg-sev-medium', text: 'text-sev-medium' },
  offline: { label: 'OFFLINE', dot: 'bg-danger', text: 'text-[#F87171]' },
  connecting: { label: 'MENYAMBUNG', dot: 'bg-muted-fg', text: 'text-muted-fg' },
}

function LiveIndicator({ connection, lastUpdate }: Pick<Props, 'connection' | 'lastUpdate'>) {
  const [, force] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = STATUS[connection]
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {connection === 'live' && (
          <motion.span
            className={`absolute inset-0 rounded-full ${s.dot}`}
            animate={{ opacity: [0.7, 0], scale: [1, 2.2] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <span className={`relative h-2.5 w-2.5 rounded-full ${s.dot}`} />
      </span>
      <span className={`font-mono text-xs font-semibold tracking-wider ${s.text}`}>{s.label}</span>
      <span className="hidden font-mono text-xs text-muted-fg tabular sm:inline">
        {lastUpdate ? clockWIB(lastUpdate) : 'belum ada data server'}
      </span>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <motion.span
        key={value}
        initial={{ opacity: 0.4, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`font-mono text-base font-semibold tabular ${tone ?? 'text-fg'}`}
      >
        {value}
      </motion.span>
      <span className="text-[11px] text-muted-fg">{label}</span>
    </div>
  )
}

export function TopBar({ connection, lastUpdate, stats, onReport }: Props) {
  return (
    <header className="glass pointer-events-auto flex h-14 items-center gap-3 rounded-xl px-3 md:gap-5 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-danger/15 text-danger" aria-hidden>
          <TriangleAlert size={18} strokeWidth={2.4} />
        </span>
        <h1 className="truncate font-mono text-sm font-semibold tracking-tight md:text-base">
          Waspada <span className="text-muted-fg">Nusantara</span>
        </h1>
      </div>

      <div className="h-6 w-px bg-white/10" aria-hidden />
      <LiveIndicator connection={connection} lastUpdate={lastUpdate} />

      <div className="ml-2 hidden items-center gap-5 lg:flex" aria-label="Ringkasan statistik">
        <Stat label="Kejadian aktif" value={stats.active} />
        <Stat label="Kritis" value={stats.critical} tone="text-[#F87171]" />
        <Stat label="Petugas dikirim" value={stats.dispatched} tone="text-accent" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onReport}
          className="hidden h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-sm font-medium transition-colors duration-200 hover:bg-white/10 sm:flex"
        >
          <Megaphone size={16} aria-hidden />
          Lapor
        </button>
        <a
          href="tel:112"
          className="flex h-9 items-center gap-2 rounded-lg bg-[#DC2626] px-3 text-sm font-semibold text-white shadow-[0_0_0_1px_rgb(255_255_255/0.15)] transition-colors duration-200 hover:bg-[#B91C1C]"
          aria-label="Hubungi 112, layanan darurat"
        >
          <Phone size={16} aria-hidden />
          <span className="hidden sm:inline">Hubungi</span> 112
        </a>
      </div>
    </header>
  )
}
