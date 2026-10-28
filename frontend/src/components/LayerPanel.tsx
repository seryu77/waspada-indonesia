import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Cctv, Layers, PanelLeftClose, Siren, X } from 'lucide-react'
import type { HazardType, LayerVisibility, ZoneKind } from '../types'
import { HAZARD_ORDER, HAZARDS, ROUTES, ZONE_ORDER, ZONES } from '../lib/hazards'
import { Legend } from './Legend'

interface ControlsProps {
  layers: LayerVisibility
  setLayers: (fn: (l: LayerVisibility) => LayerVisibility) => void
  counts: Partial<Record<HazardType, number>>
  cameraCount: { online: number; total: number }
  onTriggerDemo: () => void
}

function Toggle({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-white/5"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 rounded accent-[#22C55E]"
      />
      {children}
    </label>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-0.5">
      <legend className="mb-1 px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-fg">{title}</legend>
      {children}
    </fieldset>
  )
}

export function LayerControls({ layers, setLayers, counts, cameraCount, onTriggerDemo }: ControlsProps) {
  const allHazards = HAZARD_ORDER.every((h) => layers.hazards[h])
  return (
    <div className="space-y-4">
      <Section title="Jenis bahaya">
        <Toggle
          id="hz-all"
          checked={allHazards}
          onChange={(v) => setLayers((l) => ({ ...l, hazards: Object.fromEntries(HAZARD_ORDER.map((h) => [h, v])) as LayerVisibility['hazards'] }))}
        >
          <span className="font-medium">Semua jenis</span>
        </Toggle>
        {HAZARD_ORDER.map((h) => {
          const { Icon, color, label } = HAZARDS[h]
          return (
            <Toggle key={h} id={`hz-${h}`} checked={layers.hazards[h]} onChange={(v) => setLayers((l) => ({ ...l, hazards: { ...l.hazards, [h]: v } }))}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: color }} aria-hidden>
                <Icon size={13} color="#0F172A" strokeWidth={2.4} />
              </span>
              <span className="flex-1">{label}</span>
              <span className="font-mono text-xs text-muted-fg tabular">{counts[h] ?? 0}</span>
            </Toggle>
          )
        })}
      </Section>

      <Section title="Area bahaya">
        {ZONE_ORDER.map((z: ZoneKind) => {
          const s = ZONES[z]
          return (
            <Toggle key={z} id={`zone-${z}`} checked={layers.zones[z]} onChange={(v) => setLayers((l) => ({ ...l, zones: { ...l.zones, [z]: v } }))}>
              <span
                className="h-4 w-6 shrink-0 rounded-sm"
                style={{ background: `${s.fill}55`, border: `1.5px ${s.dash ? 'dashed' : 'solid'} ${s.stroke}` }}
                aria-hidden
              />
              <span className="flex-1">{s.label}</span>
            </Toggle>
          )
        })}
      </Section>

      <Section title="Rute">
        {(['blocked', 'danger'] as const).map((r) => (
          <Toggle key={r} id={`route-${r}`} checked={layers.routes[r]} onChange={(v) => setLayers((l) => ({ ...l, routes: { ...l.routes, [r]: v } }))}>
            <svg width="24" height="8" aria-hidden className="shrink-0">
              <line x1="1" y1="4" x2="23" y2="4" stroke={ROUTES[r].color} strokeWidth="3" strokeLinecap="round" strokeDasharray={ROUTES[r].dash ? '5 4' : undefined} />
            </svg>
            <span className="flex-1">{ROUTES[r].label}</span>
          </Toggle>
        ))}
      </Section>

      <Section title="Sensor">
        <Toggle id="cams" checked={layers.cameras} onChange={(v) => setLayers((l) => ({ ...l, cameras: v }))}>
          <Cctv size={18} className="shrink-0 text-fg" aria-hidden />
          <span className="flex-1">Titik CCTV</span>
          <span className="font-mono text-xs text-muted-fg tabular">
            {cameraCount.online}/{cameraCount.total} online
          </span>
        </Toggle>
      </Section>

      <Section title="Mode demo">
        <button
          type="button"
          onClick={onTriggerDemo}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 text-sm font-medium transition-colors duration-150 hover:bg-white/10"
        >
          <Siren size={16} className="text-[#F87171]" aria-hidden />
          Picu kejadian demo
        </button>
        <p className="px-1 pt-1 text-[11px] leading-snug text-muted-fg">Membuat kejadian kritis simulasi dari CCTV untuk mendemokan verifikasi AI dan hitung mundur 112.</p>
      </Section>
    </div>
  )
}

interface PanelProps extends ControlsProps {
  open: boolean
  setOpen: (v: boolean) => void
  mobile: boolean
}

const spring = { type: 'spring', stiffness: 420, damping: 38 } as const

export function LayerPanel({ open, setOpen, mobile, ...controls }: PanelProps) {
  const toggleBtn = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={open}
      aria-controls="layer-panel"
      className="glass pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors duration-200 hover:bg-white/10"
    >
      <Layers size={18} aria-hidden />
      Layer
    </button>
  )

  if (mobile) {
    return (
      <>
        {!open && toggleBtn}
        {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                key="scrim"
                className="pointer-events-auto fixed inset-0 z-40 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <motion.aside
                key="drawer"
                id="layer-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Pengaturan layer peta"
                className="glass-strong scroll-thin pointer-events-auto fixed inset-y-0 left-0 z-50 w-[min(320px,86vw)] overflow-y-auto p-4"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={spring}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-mono text-sm font-semibold">Layer peta</h2>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Tutup panel layer" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10">
                    <X size={18} aria-hidden />
                  </button>
                </div>
                <LayerControls {...controls} />
                <div className="mt-4 border-t border-white/10 pt-4">
                  <Legend inline />
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body,
        )}
      </>
    )
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {open ? (
        <motion.aside
          key="panel"
          id="layer-panel"
          aria-label="Pengaturan layer peta"
          className="glass scroll-thin pointer-events-auto max-h-full w-64 overflow-y-auto rounded-xl p-3"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={spring}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 font-mono text-sm font-semibold">
              <Layers size={16} aria-hidden /> Layer peta
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Ciutkan panel layer"
              aria-expanded={open}
              aria-controls="layer-panel"
              className="grid h-8 w-8 place-items-center rounded-lg transition-colors duration-150 hover:bg-white/10"
            >
              <PanelLeftClose size={16} aria-hidden />
            </button>
          </div>
          <LayerControls {...controls} />
        </motion.aside>
      ) : (
        <motion.div key="btn" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={spring}>
          {toggleBtn}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
