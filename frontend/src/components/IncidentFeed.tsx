import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Radio, Siren } from 'lucide-react'
import type { Incident } from '../types'
import { SOURCE_KIND_LABEL } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { timeAgo } from '../lib/format'
import { HazardBadge, SeverityChip, VerifyBadge } from './bits'

interface Props {
  incidents: Incident[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const list = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
} as const

export function IncidentFeed({ incidents, selectedId, onSelect }: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])

  if (incidents.length === 0) {
    return (
      <div className="grid h-40 place-items-center px-6 text-center text-sm text-muted-fg">
        Tidak ada kejadian untuk layer yang dipilih. Aktifkan jenis bahaya di panel Layer.
      </div>
    )
  }

  return (
    <motion.ul variants={list} initial="hidden" animate="show" className="space-y-1.5 p-2" aria-label="Daftar kejadian aktif, urut dari severity tertinggi">
      <AnimatePresence initial={false}>
        {incidents.map((i) => {
          const sev = effectiveSeverity(i)
          const countdown = i.dispatch?.state === 'countdown'
          return (
            <motion.li
              key={i.id}
              layout="position"
              variants={item}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
            >
              <button
                type="button"
                onClick={() => onSelect(i.id)}
                aria-current={selectedId === i.id ? 'true' : undefined}
                className={`group flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors duration-150 ${
                  selectedId === i.id ? 'border-white/40 bg-white/10' : 'border-white/5 bg-card/60 hover:border-white/15 hover:bg-card'
                } ${sev === 'critical' ? 'shadow-[inset_3px_0_0_#EF4444]' : ''}`}
              >
                <HazardBadge type={i.type} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <SeverityChip severity={sev} />
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-fg tabular">{timeAgo(i.reported_at, now)}</span>
                  </span>
                  <span className="mt-1 block truncate text-sm font-medium text-fg">{i.title}</span>
                  <span className="block truncate text-xs text-muted-fg">{i.address}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-fg">
                      <Radio size={12} aria-hidden />
                      {SOURCE_KIND_LABEL[i.source.kind]}
                    </span>
                    <VerifyBadge incident={i} />
                    {countdown && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F87171]">
                        <Siren size={12} aria-hidden /> Hitung mundur 112
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </motion.ul>
  )
}
