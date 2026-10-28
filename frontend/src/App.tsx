import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { MapPin, Megaphone, WifiOff, X } from 'lucide-react'
import type { HazardType, Incident, LayerVisibility, ReportInput } from './types'
import { useLiveData } from './store/useLiveData'
import { HAZARD_ORDER } from './lib/hazards'
import { effectiveSeverity, sortIncidents } from './lib/sort'
import { MapView } from './map/MapView'
import { MAP_ENGINE } from './map/engine'
import type { FocusTarget } from './map/types'
import { TopBar } from './components/TopBar'
import { LayerPanel } from './components/LayerPanel'
import { Legend } from './components/Legend'
import { IncidentPanel } from './components/IncidentPanel'
import { BottomSheet } from './components/BottomSheet'
import { Toasts } from './components/Toasts'
import { ReportForm } from './components/ReportForm'

const DEFAULT_LAYERS: LayerVisibility = {
  hazards: Object.fromEntries(HAZARD_ORDER.map((h) => [h, true])) as Record<HazardType, boolean>,
  zones: { burn: true, smoke: true, flood: true, volcano_exclusion: true, crime: true },
  routes: { blocked: true, danger: true },
  cameras: true,
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

export default function App() {
  const live = useLiveData()
  const { snapshot } = live
  const mobile = !useMedia('(min-width: 900px)')
  const wide = useMedia('(min-width: 1024px)')

  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 1280)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [pickMode, setPickMode] = useState(false)
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null)

  const active = useMemo(() => snapshot.incidents.filter((i) => i.status === 'active'), [snapshot.incidents])
  const visible = useMemo(() => sortIncidents(active.filter((i) => layers.hazards[i.type])), [active, layers.hazards])
  const zones = useMemo(() => snapshot.zones.filter((z) => layers.zones[z.kind]), [snapshot.zones, layers.zones])
  const routes = useMemo(() => snapshot.routes.filter((r) => layers.routes[r.kind]), [snapshot.routes, layers.routes])
  const cameras = layers.cameras ? snapshot.cameras : []
  const selected = selectedId ? (snapshot.incidents.find((i) => i.id === selectedId) ?? null) : null

  const counts = useMemo(() => {
    const c: Partial<Record<HazardType, number>> = {}
    active.forEach((i) => (c[i.type] = (c[i.type] ?? 0) + 1))
    return c
  }, [active])

  const stats = useMemo(
    () => ({
      active: active.length,
      critical: active.filter((i) => effectiveSeverity(i) === 'critical').length,
      dispatched: active.filter((i) => i.dispatch?.state === 'sent').length,
    }),
    [active],
  )

  const flyTo = useCallback((i: Incident) => setFocus({ lat: i.lat, lng: i.lng, zoom: 11, key: Date.now() }), [])

  const select = useCallback(
    (id: string) => {
      const inc = snapshot.incidents.find((i) => i.id === id)
      setSelectedId(id)
      if (inc) {
        flyTo(inc)
        // Pastikan jenisnya terlihat di peta
        if (!layers.hazards[inc.type]) setLayers((l) => ({ ...l, hazards: { ...l.hazards, [inc.type]: true } }))
      }
      if (mobile) setSheetExpanded(true)
    },
    [snapshot.incidents, flyTo, layers.hazards, mobile],
  )

  const submitReport = async (r: ReportInput) => {
    const inc = await live.submitReport(r)
    setReportOpen(false)
    setPicked(null)
    select(inc.id)
  }

  const panelHeader = (
    <div className="flex items-center justify-between px-3 pt-3">
      <h2 className="font-mono text-sm font-semibold">Kejadian aktif</h2>
      <span className="font-mono text-xs text-muted-fg tabular">{visible.length} ditampilkan</span>
    </div>
  )

  const panel = (
    <IncidentPanel
      incidents={visible}
      selected={selected}
      cameras={snapshot.cameras}
      onSelect={select}
      onBack={() => setSelectedId(null)}
      onFocus={flyTo}
      onConfirm={live.confirmDispatch}
      onCancel={live.cancelDispatch}
      header={mobile ? undefined : panelHeader}
    />
  )

  return (
    <MotionConfig reducedMotion="user">
      <a href="#incident-panel" className="sr-only-focusable fixed left-3 top-3 z-[60] rounded-lg bg-fg px-3 py-2 text-sm font-semibold text-bg">
        Lompat ke daftar kejadian
      </a>

      <main className="relative h-full w-full">
        {/* Lapisan UI di atas peta */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-2 md:p-3">
          <TopBar connection={live.connection} lastUpdate={live.lastUpdate} stats={stats} onReport={() => setReportOpen(true)} />

          <AnimatePresence>
            {live.offline && (
              <motion.div
                key="offline"
                role="status"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="pointer-events-auto mx-auto mt-2 flex items-center gap-2 rounded-lg border border-sev-medium/40 bg-[#422006]/90 px-3 py-1.5 text-xs text-[#FDE68A]"
              >
                <WifiOff size={14} aria-hidden />
                Mode offline: server tidak terjangkau, menampilkan data demo dan simulator lokal.
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative mt-2 flex min-h-0 flex-1 gap-3">
            {/* Kiri */}
            <div className="flex min-h-0 flex-col items-start gap-2">
              <LayerPanel
                open={layersOpen}
                setOpen={(v) => {
                  setLayersOpen(v)
                  if (v && mobile) setSheetExpanded(false)
                }}
                mobile={mobile}
                layers={layers}
                setLayers={setLayers}
                counts={counts}
                cameraCount={{ online: snapshot.cameras.filter((c) => c.status === 'online').length, total: snapshot.cameras.length }}
                onTriggerDemo={() => {
                  void live.triggerDemo()
                  if (mobile) setLayersOpen(false)
                }}
              />
              {mobile && (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="glass pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium sm:hidden"
                >
                  <Megaphone size={18} aria-hidden /> Lapor
                </button>
              )}
            </div>

            {/* Toast di tengah atas */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-2 md:px-[300px]">
              <Toasts toasts={live.newCritical} onOpen={select} onDismiss={live.dismissToast} />
            </div>

            {/* Kanan (desktop / tablet) */}
            {!mobile && (
              <aside
                id="incident-panel"
                aria-label="Feed dan detail kejadian"
                className={`glass scroll-thin pointer-events-auto ml-auto min-h-0 overflow-y-auto rounded-xl ${wide ? 'w-[380px]' : 'w-[340px]'}`}
              >
                {panel}
              </aside>
            )}
          </div>

          {!mobile && (
            <div className="mt-2 flex items-end">
              <Legend />
              <span className="ml-3 hidden font-mono text-[11px] text-muted-fg lg:inline">Peta: {MAP_ENGINE}</span>
            </div>
          )}
        </div>

        {/* Peta di akhir urutan DOM supaya Tab mencapai kontrol UI lebih dulu */}
        <div className="absolute inset-0 z-0">
          <MapView
            incidents={visible}
            zones={zones}
            routes={routes}
            cameras={cameras}
            selectedId={selectedId}
            onSelect={select}
            focus={focus}
            pickMode={pickMode}
            picked={reportOpen || pickMode ? picked : null}
            onPick={(lat, lng) => {
              setPicked({ lat, lng })
              setPickMode(false)
            }}
          />
        </div>

        {/* Mobile: bottom sheet */}
        {mobile && (
          <div id="incident-panel" className="pointer-events-none absolute inset-0 z-20">
            <BottomSheet
              expanded={sheetExpanded}
              setExpanded={setSheetExpanded}
              summary={
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-mono text-sm font-semibold">Kejadian aktif</h2>
                  <div className="flex items-center gap-3 font-mono text-xs tabular">
                    <span>{stats.active} aktif</span>
                    <span className="text-[#F87171]">{stats.critical} kritis</span>
                    <span className="text-accent">{stats.dispatched} dikirim</span>
                  </div>
                </div>
              }
            >
              {panel}
            </BottomSheet>
          </div>
        )}

        {/* Mode pilih lokasi */}
        <AnimatePresence>
          {pickMode && (
            <motion.div
              key="pick"
              role="status"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="glass-strong fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl px-3 py-2 text-sm"
            >
              <MapPin size={16} aria-hidden /> Klik peta untuk memilih lokasi kejadian
              <button type="button" onClick={() => setPickMode(false)} aria-label="Batal pilih lokasi" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10">
                <X size={16} aria-hidden />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {reportOpen && (
            <ReportForm
              key="report"
              hidden={pickMode}
              picked={picked}
              setPicked={setPicked}
              onPickOnMap={() => {
                setPickMode(true)
                setSheetExpanded(false)
              }}
              onClose={() => {
                setReportOpen(false)
                setPicked(null)
              }}
              onSubmit={submitReport}
            />
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  )
}
