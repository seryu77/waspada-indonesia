import { useEffect, useState, type ReactNode } from 'react'
import { TONE_COLOR, type StatusTone } from '../../lib/operator'

/** Kartu kaca untuk kolom dashboard */
export function Pane({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`glass flex min-h-0 flex-col overflow-hidden rounded-2xl ${className}`}>
      {children}
    </section>
  )
}

export function PaneHeader({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex h-11 items-center justify-between gap-3 px-4">
        <h2 className="sign flex items-center gap-2 text-[14px]">{title}</h2>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const c = TONE_COLOR[tone]
  return (
    <span className="sign inline-flex shrink-0 items-center gap-1.5 text-[11px] leading-none" style={{ color: c }}>
      <span className="h-1.5 w-1.5" style={{ background: c }} aria-hidden />
      {label}
    </span>
  )
}

type Variant = 'alarm' | 'outline' | 'ghost'
const VARIANT: Record<Variant, string> = {
  alarm: 'bg-alarm text-white hover:bg-alarm-hover',
  outline: 'border border-line-strong text-dim hover:border-fg hover:text-fg',
  ghost: 'text-dim hover:bg-raised hover:text-fg',
}

export function Btn({
  children,
  onClick,
  variant = 'outline',
  disabled,
  className = '',
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  disabled?: boolean
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 disabled:opacity-50 ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * Tombol dua langkah untuk aksi yang tidak bisa dibatalkan (kirim ke 112, tolak massal).
 * Klik pertama meminta konfirmasi, klik kedua dalam 4 detik menjalankan aksi.
 */
export function ConfirmBtn({
  children,
  confirmLabel,
  onConfirm,
  variant = 'outline',
  disabled,
  className = '',
}: {
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  variant?: Variant
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <Btn
      variant={armed ? 'alarm' : variant}
      disabled={disabled || busy}
      className={className}
      onClick={async () => {
        if (!armed) return setArmed(true)
        setArmed(false)
        setBusy(true)
        try {
          await onConfirm()
        } finally {
          setBusy(false)
        }
      }}
    >
      {armed ? <span aria-live="polite">{confirmLabel}</span> : children}
    </Btn>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-[14px] font-semibold text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-muted-fg">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg transition-transform peer-checked:translate-x-4 peer-checked:bg-on-accent" />
      </span>
    </label>
  )
}
