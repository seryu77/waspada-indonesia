import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Bot, RotateCcw, X } from 'lucide-react'
import type { AutomationRules, Incident } from '../../types'
import { DEFAULT_RULES } from '../../lib/localEngine'
import { rulesImpact } from '../../lib/operator'
import { Btn, Toggle } from './ui'

interface Props {
  rules: AutomationRules
  incidents: Incident[]
  offline: boolean
  onSave: (patch: Partial<AutomationRules>) => Promise<void>
  onClose: () => void
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <label className={`block py-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold text-fg">{label}</span>
        <span className="font-display text-[20px] font-semibold leading-none tabular">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[#E9EBEE]"
      />
      <span className="block text-[12px] leading-snug text-muted-fg">{hint}</span>
    </label>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function AutomationPanel({ rules, incidents, offline, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AutomationRules>(rules)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof AutomationRules>(k: K, v: AutomationRules[K]) => {
    setSaved(false)
    setDraft((d) => ({ ...d, [k]: v }))
  }
  const patch = useMemo(() => {
    const p: Partial<AutomationRules> = {}
    for (const k of Object.keys(draft) as (keyof AutomationRules)[]) if (draft[k] !== rules[k]) Object.assign(p, { [k]: draft[k] })
    return p
  }, [draft, rules])
  const dirty = Object.keys(patch).length > 0

  const now = useMemo(() => rulesImpact(incidents, rules), [incidents, rules])
  const next = useMemo(() => rulesImpact(incidents, draft), [incidents, draft])
  const total = next.auto + next.review + next.none

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-h"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%', transition: { duration: 0.18 } }}
        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        className="glass-strong fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col"
      >
        <div className="flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 id="auto-h" className="sign flex items-center gap-2 text-[16px]">
            <Bot size={17} aria-hidden /> Aturan otomasi
          </h2>
          <button type="button" onClick={onClose} aria-label="Tutup" className="grid h-9 w-9 place-items-center text-dim hover:text-fg">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4">
          <p className="pt-3 text-[13px] leading-relaxed text-dim">
            Atur kapan sistem boleh jalan sendiri dan kapan harus menunggu operator. Perubahan berlaku untuk kejadian berikutnya. Kejadian yang sudah ada di antrean
            tidak berubah.
          </p>

          <div className="mt-2 divide-y divide-line">
            <Toggle
              label="Auto-dispatch aktif"
              hint="Matikan saat sistem diragukan (misal kamera bermasalah). Semua kejadian lalu masuk antrean validasi."
              checked={draft.auto_dispatch_enabled}
              onChange={(v) => set('auto_dispatch_enabled', v)}
            />
            <Slider
              label="Ambang auto-dispatch"
              hint="Kepastian AI minimal untuk langsung hitung mundur. Di bawahnya, operator harus memvalidasi."
              value={draft.auto_dispatch_min}
              min={0.5}
              max={0.99}
              step={0.01}
              format={pct}
              onChange={(v) => set('auto_dispatch_min', v)}
              disabled={!draft.auto_dispatch_enabled}
            />
            <Slider
              label="Lama hitung mundur"
              hint="Waktu operator untuk membatalkan sebelum payload terkirim otomatis ke command center."
              value={draft.countdown_s}
              min={10}
              max={180}
              step={5}
              format={(v) => `${v} dtk`}
              onChange={(v) => set('countdown_s', v)}
              disabled={!draft.auto_dispatch_enabled}
            />
            <Slider
              label="Sembunyikan false alarm"
              hint="False alarm dengan kepastian setinggi ini langsung ditutup AI. Tetap tercatat di log dan audit."
              value={draft.false_alarm_hide_min}
              min={0.5}
              max={0.99}
              step={0.01}
              format={pct}
              onChange={(v) => set('false_alarm_hide_min', v)}
            />
            <Toggle
              label="Laporan warga wajib divalidasi"
              hint="Laporan warga tidak pernah terkirim otomatis, berapa pun kepastian AI."
              checked={draft.citizen_requires_review}
              onChange={(v) => set('citizen_requires_review', v)}
            />
            <Toggle
              label="Gempa BMKG M6+ langsung hitung mundur"
              hint="Data resmi BMKG, tanpa verifikasi LLM. Kalau dimatikan, masuk antrean validasi."
              checked={draft.official_quake_auto}
              onChange={(v) => set('official_quake_auto', v)}
            />
          </div>

          <section aria-labelledby="impact-h" className="my-4 rounded-lg bg-raised px-3 py-3">
            <h3 id="impact-h" className="sign text-[12px] text-muted-fg">
              Simulasi pada {total} kejadian aktif terverifikasi
            </h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Auto-dispatch', 'auto', '#F2555A'],
                  ['Validasi', 'review', '#EAB308'],
                  ['Dipantau', 'none', '#929AA4'],
                ] as const
              ).map(([label, k, color]) => (
                <div key={k}>
                  <dt className="text-[11px] text-muted-fg">{label}</dt>
                  <dd className="font-display text-[24px] font-semibold leading-tight tabular" style={{ color }}>
                    {next[k]}
                  </dd>
                  {now[k] !== next[k] && <dd className="text-[11px] text-muted-fg tabular">sekarang {now[k]}</dd>}
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] leading-snug text-muted-fg">Menunjukkan jalur yang akan diambil kalau kejadian tersebut masuk sekarang dengan aturan di atas.</p>
          </section>
        </div>

        <div className="shrink-0 space-y-2 border-t border-line px-4 py-3">
          {error && (
            <p role="alert" className="text-[13px] text-sev-critical">
              {error}
            </p>
          )}
          {offline && <p className="text-[12px] text-sev-medium">Mode offline: aturan hanya berlaku untuk simulator di browser ini.</p>}
          <div className="flex gap-2">
            <Btn
              variant="alarm"
              className="flex-1"
              disabled={!dirty || busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await onSave(patch)
                  setSaved(true)
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Gagal menyimpan')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {saved && !dirty ? 'Tersimpan' : busy ? 'Menyimpan...' : 'Simpan aturan'}
            </Btn>
            <Btn variant="ghost" onClick={() => setDraft({ ...DEFAULT_RULES })} title="Kembalikan ke aturan bawaan">
              <RotateCcw size={14} aria-hidden /> Default
            </Btn>
          </div>
        </div>
      </motion.aside>
    </>
  )
}
