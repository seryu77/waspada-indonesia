import { motion, useReducedMotion } from 'motion/react'
import type { Incident } from '../../types'
import { HAZARDS, SEVERITY } from '../../lib/hazards'
import { effectiveSeverity } from '../../lib/sort'

interface Props {
  incident: Incident
  selected: boolean
  onSelect: (id: string) => void
}

/**
 * Hierarki lewat bentuk, bukan hanya warna:
 * - kritis: blok warna penuh + pulse (selama belum ditangani)
 * - tinggi: kotak gelap, bingkai tebal berwarna
 * - sedang/rendah: kotak gelap kecil, bingkai tipis
 */
export function IncidentMarker({ incident, selected, onSelect }: Props) {
  const reduce = useReducedMotion()
  const meta = HAZARDS[incident.type]
  const sev = effectiveSeverity(incident)
  const critical = sev === 'critical'
  const handled = incident.dispatch?.state === 'sent' || incident.dispatch?.state === 'cancelled'
  const size = critical ? 30 : sev === 'high' ? 26 : 22
  const border = critical ? 0 : sev === 'high' ? 2 : 1.5
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
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      {critical && !handled && !reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-xs"
          style={{ boxShadow: `0 0 0 2px ${SEVERITY.critical.color}` }}
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 2.1, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <motion.span
        aria-hidden
        className="relative grid h-full w-full place-items-center rounded-xs"
        style={{
          background: critical ? meta.color : '#0B0D10',
          boxShadow: `inset 0 0 0 ${border}px ${meta.color}, 0 0 0 ${selected ? 2 : 0}px #FFFFFF, 0 2px 8px rgb(0 0 0 / 0.6)`,
        }}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: selected ? 1.2 : 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 460, damping: 26 }}
      >
        <Icon size={size * 0.55} color={critical ? '#0B0D10' : meta.color} strokeWidth={2.4} />
      </motion.span>
      {incident.verifying && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 border-2 border-bg bg-sev-medium" />}
    </button>
  )
}
