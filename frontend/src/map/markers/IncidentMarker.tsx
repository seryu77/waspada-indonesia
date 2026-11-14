import { memo, type MouseEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Incident } from '../../types'
import { HAZARDS, SEVERITY } from '../../lib/hazards'
import { effectiveSeverity } from '../../lib/sort'
import { incidentMarkerLabel } from './labels'
import { SATELLITE_UNCONFIRMED, satelliteUnconfirmed } from '../../lib/citizen'
import { useMedia } from '../../lib/hooks'

interface Props {
  incident: Incident
  selected: boolean
  /** Tanpa onSelect, marker hanya tampilan (klik ditangani AdvancedMarker Google Maps). */
  onSelect?: (id: string) => void
}

/**
 * Hierarki lewat bentuk, bukan hanya warna:
 * - kritis: blok warna penuh + pulse (selama belum ditangani)
 * - tinggi: kotak gelap, bingkai tebal berwarna
 * - sedang/rendah: kotak gelap kecil, bingkai tipis
 */
export const IncidentMarker = memo(function IncidentMarker({ incident, selected, onSelect }: Props) {
  const reduce = useReducedMotion()
  const meta = HAZARDS[incident.type]
  const sev = effectiveSeverity(incident)
  const critical = sev === 'critical'
  const handled = incident.dispatch?.state === 'sent' || incident.dispatch?.state === 'cancelled'
  // Titik panas satelit yang belum terkonfirmasi tidak berdenyut, supaya tidak terkesan darurat pasti
  const tentative = satelliteUnconfirmed(incident)
  // Di layar HP marker diperkecil supaya peta tidak tertutup tumpukan marker
  const compact = useMedia('(max-width: 767px)')
  const size = compact ? (critical ? 20 : sev === 'high' ? 18 : 15) : critical ? 30 : sev === 'high' ? 26 : 22
  const border = critical ? 0 : sev === 'high' ? (compact ? 1.5 : 2) : compact ? 1 : 1.5
  const Icon = meta.Icon
  const Tag = onSelect ? 'button' : 'div'
  const interactive = onSelect
    ? {
        type: 'button' as const,
        onClick: (e: MouseEvent) => {
          e.stopPropagation()
          onSelect(incident.id)
        },
        'aria-label': incidentMarkerLabel(incident),
        title: tentative ? `${incident.title} (${SATELLITE_UNCONFIRMED})` : incident.title,
      }
    : { 'aria-hidden': true }

  return (
    <Tag {...interactive} className={`relative grid place-items-center ${onSelect ? '' : 'cursor-pointer'}`} style={{ width: size, height: size }}>
      {critical && !handled && !tentative && !reduce && (
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
    </Tag>
  )
})
