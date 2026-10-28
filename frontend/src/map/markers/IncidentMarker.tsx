import { motion, useReducedMotion } from 'motion/react'
import type { Incident } from '../../types'
import { HAZARDS, SEVERITY } from '../../lib/hazards'
import { effectiveSeverity } from '../../lib/sort'

interface Props {
  incident: Incident
  selected: boolean
  onSelect: (id: string) => void
}

export function IncidentMarker({ incident, selected, onSelect }: Props) {
  const reduce = useReducedMotion()
  const meta = HAZARDS[incident.type]
  const sev = effectiveSeverity(incident)
  const critical = sev === 'critical'
  // Pulse hanya untuk kejadian kritis yang belum ditangani (belum terkirim/dibatalkan)
  const handled = incident.dispatch?.state === 'sent' || incident.dispatch?.state === 'cancelled'
  const size = critical ? 34 : sev === 'high' ? 30 : 26
  const Icon = meta.Icon

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect(incident.id)
      }}
      aria-label={`${meta.label}: ${incident.title}, ${SEVERITY[sev].label}. ${incident.address}`}
      title={incident.title}
      className="relative grid place-items-center rounded-full"
      style={{ width: size, height: size }}
    >
      {critical && !handled && !reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: SEVERITY.critical.color }}
          initial={{ scale: 1, opacity: 0.55 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <motion.span
        aria-hidden
        className="relative grid h-full w-full place-items-center rounded-full shadow-lg"
        style={{
          background: meta.color,
          boxShadow: `0 0 0 ${selected ? 3 : 2}px ${selected ? '#FFFFFF' : SEVERITY[sev].color}, 0 4px 12px rgb(0 0 0 / 0.5)`,
        }}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: selected ? 1.15 : 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 24 }}
      >
        <Icon size={size * 0.52} color="#0F172A" strokeWidth={2.4} />
      </motion.span>
      {incident.verifying && (
        <span aria-hidden className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-bg bg-sev-medium" />
      )}
    </button>
  )
}
