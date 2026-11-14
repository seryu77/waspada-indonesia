import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShieldQuestion, Siren } from 'lucide-react'
import type { Incident } from '../types'
import { SEVERITY, SOURCE_KIND_LABEL } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { timeAgo } from '../lib/format'
import { HazardBadge, SeverityTag, VerifyBadge } from './bits'

interface Props {
  incidents: Incident[]
  selectedId: string | null
  onSelect: (id: string) => void
  operator: boolean
}

export function IncidentFeed({ incidents, selectedId, onSelect, operator }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])

  // Id yang sudah tampil saat render pertama tidak diberi sorotan "baru"
  const [firstIds] = useState(() => new Set(incidents.map((i) => i.id)))

  if (incidents.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-fg">Tidak ada kejadian untuk layer yang dipilih. Aktifkan jenis bahaya di panel Layer.</p>
  }

  return (
    <ul className="divide-y divide-line" aria-label="Daftar kejadian aktif, urut dari severity tertinggi">
      <AnimatePresence initial={false}>
        {incidents.map((i) => {
          const sev = effectiveSeverity(i)
          const color = SEVERITY[sev].color
          const isNew = !firstIds.has(i.id)
          const active = selectedId === i.id
          return (
            <motion.li
              key={i.id}
              layout="position"
              transition={{ layout: { type: 'spring', stiffness: 500, damping: 42 } }}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <button
                type="button"
                onClick={() => onSelect(i.id)}
                aria-current={active ? 'true' : undefined}
                className={`relative grid w-full grid-cols-[3px_32px_1fr] items-start gap-x-3 py-3 pr-4 text-left transition-colors duration-150 ${
                  active ? 'bg-raised' : 'hover:bg-raised/70'
                }`}
              >
                {/* Kilatan sorot: penanda kejadian yang baru masuk */}
                {isNew && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{ background: color }}
                    initial={{ opacity: 0.22 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 1.8, ease: 'easeOut' }}
                  />
                )}
                <span className="h-full self-stretch" style={{ background: sev === 'critical' || sev === 'high' ? color : 'transparent' }} aria-hidden />
                <HazardBadge type={i.type} size={32} solid={sev === 'critical'} />
                <span className="relative min-w-0">
                  <span className="flex items-baseline gap-3">
                    <SeverityTag severity={sev} />
                    <span className="ml-auto shrink-0 text-xs text-muted-fg tabular">{timeAgo(i.reported_at, now)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[15px] font-semibold leading-snug text-fg">{i.title}</span>
                  <span className="block truncate text-[13px] text-muted-fg">{i.address}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs text-dim">{SOURCE_KIND_LABEL[i.source.kind]}</span>
                    <VerifyBadge incident={i} operator={operator} />
                    {operator && i.dispatch?.state === 'countdown' && (
                      <span className="sign inline-flex items-center gap-1 text-[12px] text-sev-critical">
                        <Siren size={12} aria-hidden /> Auto-dispatch 112
                      </span>
                    )}
                    {operator && i.dispatch?.state === 'review' && (
                      <span className="sign inline-flex items-center gap-1 text-[12px] text-sev-medium">
                        <ShieldQuestion size={12} aria-hidden /> Butuh validasi
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
