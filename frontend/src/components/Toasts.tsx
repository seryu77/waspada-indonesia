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

function ToastItem({ inc, onOpen, onDismiss }: { inc: Incident; onOpen: (id: string) => void; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(inc.id), 9000)
    return () => window.clearTimeout(t)
  }, [inc.id, onDismiss])
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className="glass-strong pointer-events-auto flex w-full items-start gap-3 rounded-xl p-3 shadow-[inset_3px_0_0_#EF4444,0_8px_24px_rgb(0_0_0/0.4)]"
    >
      <HazardBadge type={inc.type} size={30} />
      <button type="button" onClick={() => onOpen(inc.id)} className="min-w-0 flex-1 text-left">
        <span className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-[#F87171]">Kejadian kritis baru</span>
        <span className="block truncate text-sm font-medium">
          {HAZARDS[inc.type].label}: {inc.title}
        </span>
        <span className="block truncate text-xs text-muted-fg">{inc.address}</span>
      </button>
      <button type="button" onClick={() => onDismiss(inc.id)} aria-label="Tutup notifikasi" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-fg hover:bg-white/10 hover:text-fg">
        <X size={16} aria-hidden />
      </button>
    </motion.li>
  )
}

export function Toasts({ toasts, onOpen, onDismiss }: Props) {
  return (
    <ol aria-live="assertive" aria-label="Notifikasi kejadian kritis" className="pointer-events-none flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} inc={t} onOpen={onOpen} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </ol>
  )
}
