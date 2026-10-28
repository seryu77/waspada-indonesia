import { motion } from 'motion/react'
import { Bot, CircleCheck, CircleHelp, CircleX, Loader } from 'lucide-react'
import type { HazardType, Incident, Severity } from '../types'
import { HAZARDS, SEVERITY } from '../lib/hazards'

export function HazardBadge({ type, size = 32 }: { type: HazardType; size?: number }) {
  const { Icon, color } = HAZARDS[type]
  return (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: color }} aria-hidden>
      <Icon size={size * 0.5} color="#0F172A" strokeWidth={2.4} />
    </span>
  )
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: s.color, background: `${s.color}1F`, boxShadow: `inset 0 0 0 1px ${s.color}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden />
      {s.label}
    </span>
  )
}

export function VerifyBadge({ incident }: { incident: Incident }) {
  if (incident.verifying) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-sev-medium">
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} className="inline-flex" aria-hidden>
          <Loader size={12} />
        </motion.span>
        Diverifikasi AI...
      </span>
    )
  }
  const v = incident.verification
  // Data resmi tanpa verifikasi AI: label sumber di sebelahnya sudah cukup
  if (!v) return null
  if (v.verdict === 'confirmed')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-accent">
        <CircleCheck size={12} aria-hidden /> Terverifikasi {Math.round(v.confidence * 100)}%
      </span>
    )
  if (v.verdict === 'false_alarm')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-fg">
        <CircleX size={12} aria-hidden /> False alarm
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-sev-medium">
      <CircleHelp size={12} aria-hidden /> Butuh cek manual
    </span>
  )
}

export function ModelTag({ model, simulated }: { model: string; simulated: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted-fg">
      <Bot size={12} aria-hidden />
      {model}
      {simulated && <span className="ml-1 rounded bg-sev-medium/15 px-1 text-sev-medium">simulasi</span>}
    </span>
  )
}
