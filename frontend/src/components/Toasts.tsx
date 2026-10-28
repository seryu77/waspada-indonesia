import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import type { Incident } from '../types'
import { HAZARDS } from '../lib/hazards'
import { HazardBadge } from './bits'

interface Props {
  toasts: Incident[]
  onOpen: (id: string) => void
  onDismiss: (id: string) => void
}

const LIFE_MS = 9000

function ToastItem({ inc, onOpen, onDismiss }: { inc: Incident; onOpen: (id: string) => void; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(inc.id), LIFE_MS)
    return () => window.clearTimeout(t)
  }, [inc.id, onDismiss])
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
      className="glass-strong pointer-events-auto relative w-full overflow-hidden rounded-xl"
    >
      <div className="flex items-start gap-3 py-3 pl-4 pr-2">
        <span className="absolute inset-y-0 left-0 w-1 bg-sev-critical" aria-hidden />
        <HazardBadge type={inc.type} size={30} solid />
        <button type="button" onClick={() => onOpen(inc.id)} className="min-w-0 flex-1 text-left">
          <span className="sign block text-[12px] text-sev-critical">Kritis baru, {HAZARDS[inc.type].label}</span>
          <span className="block truncate text-[15px] font-semibold">{inc.title}</span>
          <span className="block truncate text-[13px] text-muted-fg">{inc.address}</span>
        </button>
        <button type="button" onClick={() => onDismiss(inc.id)} aria-label="Tutup notifikasi" className="grid h-9 w-9 shrink-0 place-items-center text-muted-fg hover:bg-raised hover:text-fg">
          <X size={16} aria-hidden />
        </button>
      </div>
      {/* Sisa umur notifikasi */}
      <motion.span
        aria-hidden
        className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-sev-critical/60"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: LIFE_MS / 1000, ease: 'linear' }}
      />
    </motion.li>
  )
}

export function Toasts({ toasts, onOpen, onDismiss }: Props) {
  return (
    <ol aria-live="assertive" aria-label="Notifikasi kejadian kritis" className="pointer-events-none flex w-full max-w-[400px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} inc={t} onOpen={onOpen} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </ol>
  )
}
