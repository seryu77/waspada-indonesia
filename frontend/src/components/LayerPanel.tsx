import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Cctv, Flame, Layers, PanelLeftClose, PanelLeftOpen, Siren, X } from 'lucide-react'
import type { HazardType, HotspotMeta, LayerVisibility, ZoneKind } from '../types'
import { HAZARD_ORDER, HAZARDS, ROUTES, ZONE_ORDER, ZONES } from '../lib/hazards'
import { Legend } from './Legend'
import { HEAT_CSS } from '../map/heat'
import { timeAgo } from '../lib/format'
import { useNow } from '../lib/hooks'

export interface HotspotStatus {
  /** undefined = belum tersambung ke server */
  mode: HotspotMeta['mode'] | undefined
  meta?: HotspotMeta
  /** Titik satelit yang sedang tampil */
  count: number
  loading: boolean
  failed: boolean
}

interface ControlsProps {
  layers: LayerVisibility
  setLayers: (fn: (l: LayerVisibility) => LayerVisibility) => void
  counts: Partial<Record<HazardType, number>>
  cameraCount: { online: number; total: number }
  hotspots: HotspotStatus
  onTriggerDemo: () => void
}

function Row({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-h-9 items-center gap-2.5 px-3 text-sm text-dim transition-colors duration-150 hover:bg-raised hover:text-fg">
      <input id={id} type="checkbox" className="check" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <fieldset className="border-t border-line py-2 first:border-t-0">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between px-3 pb-1 pt-1">
        <span className="sign text-[12px] text-muted-fg" aria-hidden>
          {title}
        </span>
        {action}
      </div>
      {children}
    </fieldset>
  )
}

/** Status data satelit di bawah toggle heatmap: segar, menunggu, gagal, atau demo */
function hotspotText({ mode, meta, count, loading, failed }: HotspotStatus, now: number): string {
  if (failed) return 'Gagal mengambil data sebaran panas dari server. Coba matikan lalu nyalakan lagi.'
  if (loading) return 'Memuat sebaran panas...'
  if (mode === 'demo') return 'Data contoh untuk demo. Kebakaran dari CCTV dan laporan warga tetap realtime.'
  if (mode === 'off') return 'Data satelit tidak aktif. Hanya kebakaran dari CCTV dan laporan warga.'
  if (mode !== 'live') return 'Menyambung ke server...'
  if (meta?.error && !meta.updated_at) return 'Gagal memuat data satelit, mencoba lagi tiap 10 menit.'
  if (!meta?.updated_at) return 'Menunggu data satelit pertama...'
  const sats = meta.satellites.length ? ` (${meta.satellites.join(', ')})` : ''
  const latest = meta.latest_at && count ? ` Deteksi terbaru ${timeAgo(meta.latest_at, now)}.` : ''
  const warn = meta.error ? ' Pengecekan terakhir gagal, menampilkan data sebelumnya.' : ''
  return `NASA FIRMS${sats}, dicek ${timeAgo(meta.updated_at, now)}.${latest}${warn}`
}

function HotspotSection({ layers, setLayers, hotspots }: Pick<ControlsProps, 'layers' | 'setLayers' | 'hotspots'>) {
  const now = useNow(30_000)
  return (
    <Section title="Sebaran panas">
      <Row id="heat" checked={layers.heat} onChange={(v) => setLayers((l) => ({ ...l, heat: v }))}>
        <Flame size={15} className="shrink-0 text-[#FB923C]" aria-hidden />
        <span className="flex-1">Heatmap kebakaran</span>
        {layers.heat && !hotspots.loading && (
          <span className="text-xs text-muted-fg tabular" title="Titik satelit 48 jam terakhir">
            {hotspots.count}
          </span>
        )}
      </Row>
      {layers.heat ? (
        <div className="px-3 pb-1 pt-1">
          <div className="h-1.5 w-full rounded-full" style={{ background: HEAT_CSS }} aria-hidden />
          <div className="mt-1 flex justify-between text-[11px] text-muted-fg" aria-hidden>
            <span>Sedikit api</span>
            <span>Besar / rapat</span>
          </div>
          <p className="pt-1.5 text-xs leading-snug text-muted-fg" aria-live="polite">
            {hotspotText(hotspots, now)}
          </p>
        </div>
      ) : (
        <p className="px-3 pb-1 pt-0.5 text-xs leading-snug text-muted-fg">Nyalakan untuk melihat sebaran panas dari satelit, CCTV, dan laporan warga.</p>
      )}
    </Section>
  )
}

export function LayerControls({ layers, setLayers, counts, cameraCount, hotspots, onTriggerDemo }: ControlsProps) {
  const all = HAZARD_ORDER.every((h) => layers.hazards[h])
  const setAll = (v: boolean) => setLayers((l) => ({ ...l, hazards: Object.fromEntries(HAZARD_ORDER.map((h) => [h, v])) as LayerVisibility['hazards'] }))
  return (
    <div>
      <Section
        title="Jenis bahaya"
        action={
          <button type="button" onClick={() => setAll(!all)} className="text-xs font-semibold text-dim underline-offset-2 hover:text-fg hover:underline">
            {all ? 'Sembunyikan semua' : 'Tampilkan semua'}
          </button>
        }
      >
        {HAZARD_ORDER.map((h) => {
          const { Icon, color, label } = HAZARDS[h]
          return (
            <Row key={h} id={`hz-${h}`} checked={layers.hazards[h]} onChange={(v) => setLayers((l) => ({ ...l, hazards: { ...l.hazards, [h]: v } }))}>
              <Icon size={15} color={color} strokeWidth={2.2} aria-hidden />
              <span className="flex-1">{label}</span>
              <span className="text-xs text-muted-fg tabular">{counts[h] ?? 0}</span>
            </Row>
          )
        })}
      </Section>

      <HotspotSection layers={layers} setLayers={setLayers} hotspots={hotspots} />

      <Section title="Area bahaya">
        {ZONE_ORDER.map((z: ZoneKind) => {
          const s = ZONES[z]
          return (
            <Row key={z} id={`zone-${z}`} checked={layers.zones[z]} onChange={(v) => setLayers((l) => ({ ...l, zones: { ...l.zones, [z]: v } }))}>
              <span className="h-3 w-4 shrink-0" style={{ background: `${s.fill}50`, border: `1.5px ${s.dash ? 'dashed' : 'solid'} ${s.stroke}` }} aria-hidden />
              <span className="flex-1">{s.label}</span>
            </Row>
          )
        })}
      </Section>

      <Section title="Rute">
        {(['blocked', 'danger'] as const).map((r) => (
          <Row key={r} id={`route-${r}`} checked={layers.routes[r]} onChange={(v) => setLayers((l) => ({ ...l, routes: { ...l.routes, [r]: v } }))}>
            <svg width="16" height="8" aria-hidden className="shrink-0">
              <line x1="1" y1="4" x2="15" y2="4" stroke={ROUTES[r].color} strokeWidth="3" strokeDasharray={ROUTES[r].dash ? '4 3' : undefined} />
            </svg>
            <span className="flex-1">{ROUTES[r].label}</span>
          </Row>
        ))}
      </Section>

      <Section title="Sensor">
        <Row id="cams" checked={layers.cameras} onChange={(v) => setLayers((l) => ({ ...l, cameras: v }))}>
          <Cctv size={15} className="shrink-0" aria-hidden />
          <span className="flex-1">Titik CCTV</span>
          <span className="text-xs text-muted-fg tabular">
            {cameraCount.online}/{cameraCount.total}
          </span>
        </Row>
      </Section>

      <Section title="Mode demo">
        <div className="px-3 pb-1">
          <button
            type="button"
            onClick={onTriggerDemo}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line-strong text-sm font-semibold text-dim transition-colors duration-150 hover:border-sev-critical hover:text-fg"
          >
            <Siren size={15} className="text-sev-critical" aria-hidden />
            Picu kejadian demo
          </button>
          <p className="pt-1.5 text-xs leading-snug text-muted-fg">Kejadian kritis simulasi dari CCTV untuk mendemokan verifikasi AI dan hitung mundur 112.</p>
        </div>
      </Section>
    </div>
  )
}

interface PanelProps extends ControlsProps {
  open: boolean
  setOpen: (v: boolean) => void
  mobile: boolean
}

const spring = { type: 'spring', stiffness: 520, damping: 44 } as const

/** Rail ikon saat panel diciutkan: toggle cepat per jenis bahaya tanpa membuka panel. */
function IconRail({ layers, setLayers, onExpand }: Pick<ControlsProps, 'layers' | 'setLayers'> & { onExpand: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-1 py-2">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Buka panel layer"
        aria-expanded={false}
        aria-controls="layer-panel"
        className="mb-1 grid h-9 w-9 place-items-center text-dim transition-colors duration-150 hover:bg-raised hover:text-fg"
      >
        <PanelLeftOpen size={17} aria-hidden />
      </button>
      {HAZARD_ORDER.map((h) => {
        const { Icon, color, label } = HAZARDS[h]
        const on = layers.hazards[h]
        return (
          <button
            key={h}
            type="button"
            aria-pressed={on}
            aria-label={`${on ? 'Sembunyikan' : 'Tampilkan'} ${label}`}
            title={label}
            onClick={() => setLayers((l) => ({ ...l, hazards: { ...l.hazards, [h]: !on } }))}
            className="relative grid h-9 w-9 place-items-center transition-colors duration-150 hover:bg-raised"
          >
            <Icon size={16} color={on ? color : '#5B626C'} strokeWidth={2.2} aria-hidden />
            {on && <span className="absolute left-0 top-2 h-5 w-0.5" style={{ background: color }} aria-hidden />}
          </button>
        )
      })}
      <span className="my-1 h-px w-6 bg-line" aria-hidden />
      <button
        type="button"
        aria-pressed={layers.heat}
        aria-label={`${layers.heat ? 'Matikan' : 'Nyalakan'} heatmap kebakaran`}
        title="Heatmap kebakaran"
        onClick={() => setLayers((l) => ({ ...l, heat: !l.heat }))}
        className="relative grid h-9 w-9 place-items-center transition-colors duration-150 hover:bg-raised"
      >
        <span
          className="grid h-5 w-5 place-items-center rounded-full"
          style={{ background: layers.heat ? HEAT_CSS : 'transparent', border: layers.heat ? 'none' : '1.5px solid #5B626C' }}
          aria-hidden
        >
          <Flame size={11} color={layers.heat ? '#1B1D21' : '#5B626C'} strokeWidth={2.6} />
        </span>
        {layers.heat && <span className="absolute left-0 top-2 h-5 w-0.5 bg-[#EF4444]" aria-hidden />}
      </button>
    </div>
  )
}

export function LayerPanel({ open, setOpen, mobile, ...controls }: PanelProps) {
  if (mobile) {
    return (
      <>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="layer-panel"
            className="glass pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold"
          >
            <Layers size={16} aria-hidden />
            Layer
          </button>
        )}
        {createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  key="scrim"
                  className="fixed inset-0 z-40 bg-black/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  onClick={() => setOpen(false)}
                  aria-hidden
                />
                <motion.aside
                  key="drawer"
                  id="layer-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Pengaturan layer peta"
                  className="glass-strong scroll-thin fixed inset-y-2 left-2 z-50 w-[min(300px,86vw)] overflow-y-auto rounded-2xl"
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%', transition: { duration: 0.18 } }}
                  transition={spring}
                >
                  <div className="flex h-13 items-center justify-between border-b border-line px-3">
                    <h2 className="sign text-[15px]">Layer peta</h2>
                    <button type="button" onClick={() => setOpen(false)} aria-label="Tutup panel layer" className="grid h-10 w-10 place-items-center hover:bg-raised">
                      <X size={18} aria-hidden />
                    </button>
                  </div>
                  <LayerControls {...controls} />
                  <div className="border-t border-line">
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
    // Lebar berubah seketika (tidak dianimasikan) supaya peta tidak menghitung ulang ukuran tiap frame
    <aside
      id="layer-panel"
      aria-label="Pengaturan layer peta"
      className={`glass pointer-events-auto flex h-full shrink-0 flex-col overflow-hidden rounded-2xl ${open ? 'w-62' : 'w-12'}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.div
            key="open"
            className="flex min-h-0 w-[248px] flex-1 flex-col"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.18 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-3 pr-1">
              <h2 className="sign text-[14px]">Layer peta</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Ciutkan panel layer"
                aria-expanded
                aria-controls="layer-panel"
                className="grid h-9 w-9 place-items-center text-dim transition-colors duration-150 hover:bg-raised hover:text-fg"
              >
                <PanelLeftClose size={17} aria-hidden />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <LayerControls {...controls} />
              <div className="border-t border-line">
                <Legend inline />
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="rail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
            <IconRail layers={controls.layers} setLayers={controls.setLayers} onExpand={() => setOpen(true)} />
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}
