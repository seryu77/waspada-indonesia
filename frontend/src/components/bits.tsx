import { motion } from 'motion/react'
import { CircleCheck, CircleHelp, CircleX, Loader, Satellite } from 'lucide-react'
import type { HazardType, Incident, Severity } from '../types'
import { HAZARDS, SEVERITY } from '../lib/hazards'
import { SATELLITE_UNCONFIRMED, satelliteUnconfirmed } from '../lib/citizen'

/** Ikon jenis bahaya dalam kotak gelap bergaris warna, mirip pelat rambu. */
export function HazardBadge({ type, size = 32, solid = false }: { type: HazardType; size?: number; solid?: boolean }) {
  const { Icon, color } = HAZARDS[type]
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xs"
      style={{ width: size, height: size, background: solid ? color : '#0B0D10', boxShadow: `inset 0 0 0 1.5px ${color}` }}
      aria-hidden
    >
      <Icon size={size * 0.52} color={solid ? '#0B0D10' : color} strokeWidth={2.3} />
    </span>
  )
}

/** Severity sebagai teks rambu berwarna dengan blok kecil, tanpa pill. */
export function SeverityTag({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity]
  return (
    <span className="sign inline-flex items-center gap-1.5 text-[12px]" style={{ color: s.color }}>
      <span className="h-2 w-2" style={{ background: s.color }} aria-hidden />
      {s.label}
    </span>
  )
}

/** operator: halaman operator 112. Di halaman publik, titik panas satelit yang belum terkonfirmasi diberi label jujur. */
export function VerifyBadge({ incident, operator = false }: { incident: Incident; operator?: boolean }) {
  if (!operator && satelliteUnconfirmed(incident)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-sev-medium">
        <Satellite size={12} aria-hidden /> {SATELLITE_UNCONFIRMED}
      </span>
    )
  }
  if (incident.verifying) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-sev-medium">
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} className="inline-flex" aria-hidden>
          <Loader size={12} />
        </motion.span>
        Diverifikasi AI
      </span>
    )
  }
  const v = incident.verification
  // Data resmi tanpa verifikasi AI: label sumber sudah cukup
  if (!v) return null
  if (v.verdict === 'confirmed')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-accent">
        <CircleCheck size={12} aria-hidden /> Terverifikasi <span className="tabular">{Math.round(v.confidence * 100)}%</span>
      </span>
    )
  if (v.verdict === 'false_alarm')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-fg">
        <CircleX size={12} aria-hidden /> False alarm
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs text-sev-medium">
      <CircleHelp size={12} aria-hidden /> Cek manual
    </span>
  )
}

/** Bar bersegmen 10 blok: dipakai untuk confidence. */
export function SegmentBar({ value, color }: { value: number; color: string }) {
  const filled = Math.round(value * 10)
  return (
    <span className="flex gap-0.5" role="img" aria-label={`${Math.round(value * 100)} persen`}>
      {Array.from({ length: 10 }, (_, i) => (
        <motion.span
          key={i}
          className="h-2.5 w-2"
          initial={{ opacity: 0.25 }}
          animate={{ opacity: i < filled ? 1 : 0.18 }}
          transition={{ delay: i * 0.03, duration: 0.2 }}
          style={{ background: i < filled ? color : '#5B626C' }}
        />
      ))}
    </span>
  )
}
