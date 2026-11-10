import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { Inbox, MapPin, Megaphone, MessageCircle, WifiOff } from 'lucide-react'
import type { HazardType, Incident, LayerVisibility, ReportInput } from './types'
import { useLiveData } from './store/useLiveData'
import { HAZARD_ORDER } from './lib/hazards'
import { effectiveSeverity, sortForOperator, sortIncidents } from './lib/sort'
import { MapView } from './map/MapView'
import type { FocusTarget } from './map/types'
import { TopBar } from './components/TopBar'
import { LayerPanel } from './components/LayerPanel'
import { IncidentPanel } from './components/IncidentPanel'
import { BottomSheet } from './components/BottomSheet'
import { Toasts } from './components/Toasts'
import { ReportForm } from './components/ReportForm'
import { CameraViewer } from './components/CameraViewer'
import { VideoWall } from './components/VideoWall'
import { useMedia, useNow } from './lib/hooks'
import { incidentHeat, satelliteHeat } from './lib/hotspots'
import { useHotspots } from './store/useHotspots'
import { MyReports } from './components/MyReports'
import { citizenSignature, loadSeen, saveSeen } from './lib/citizen'

const DEFAULT_LAYERS: LayerVisibility = {
  hazards: Object.fromEntries(HAZARD_ORDER.map((h) => [h, true])) as Record<HazardType, boolean>,
  zones: { burn: true, smoke: true, flood: true, volcano_exclusion: true, crime: true },
  routes: { blocked: true, danger: true },
  cameras: true,
  // Mati saat awal; data titik panas baru diambil setelah pengguna menyalakan toggle
  heat: false,
}

export default function App({ operator = false }: { operator?: boolean }) {
  const live = useLiveData({ operator })
  const { snapshot } = live
  const mobile = !useMedia('(min-width: 900px)')
  const wide = useMedia('(min-width: 1024px)')

  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 1200)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [pickMode, setPickMode] = useState(false)
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [wallOpen, setWallOpen] = useState(false)
  const [mineOpen, setMineOpen] = useState<{ id: string | null } | null>(null)
  const [seen, setSeen] = useState<Record<string, string>>(loadSeen)

  const active = useMemo(() => snapshot.incidents.filter((i) => i.status === 'active'), [snapshot.incidents])
  const visible = useMemo(
    () => (operator ? sortForOperator : sortIncidents)(active.filter((i) => layers.hazards[i.type])),
    [active, layers.hazards, operator],
  )
  const zones = useMemo(() => snapshot.zones.filter((z) => layers.zones[z.kind]), [snapshot.zones, layers.zones])
  const routes = useMemo(() => snapshot.routes.filter((r) => layers.routes[r.kind]), [snapshot.routes, layers.routes])
  const cameras = layers.cameras ? snapshot.cameras : []

  // Heatmap kebakaran (hanya saat toggle aktif): titik satelit (FIRMS, atau data contoh saat
  // demo/offline) ditambah kebakaran dari CCTV dan laporan warga yang masuk realtime.
  // Jam diperbarui tiap 30 detik supaya titik lama memudar dan titik demo baru muncul.
  const heatNow = useNow(30_000)
  const hotspotMode = live.offline ? 'demo' : snapshot.hotspot_meta?.mode
  const satellite = useHotspots(layers.heat, hotspotMode, snapshot.hotspot_meta?.version, heatNow)
  const heat = useMemo(
    () => (layers.heat ? [...satelliteHeat(satellite.points, heatNow), ...incidentHeat(active, heatNow)] : []),
    [layers.heat, satellite.points, active, heatNow],
  )
  const selected = selectedId ? (snapshot.incidents.find((i) => i.id === selectedId) ?? null) : null
  const camera = cameraId ? (snapshot.cameras.find((c) => c.id === cameraId) ?? null) : null

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
      review: active.filter((i) => i.dispatch?.state === 'review').length,
    }),
    [active],
  )

  const flyTo = useCallback((i: Incident) => setFocus({ lat: i.lat, lng: i.lng, zoom: 11, key: Date.now() }), [])

  // Data terbaru lewat ref, supaya callback untuk marker tetap sama dan marker tidak render ulang
  // tiap ada update realtime
  const latest = useRef({ snapshot, layers, mobile })
  useEffect(() => {
    latest.current = { snapshot, layers, mobile }
  })

  // Laporan saya: kabar baru = tahap status atau pesan operator berubah sejak terakhir dibuka
  const myIds = useMemo(() => new Set(live.myReports.map((r) => r.id)), [live.myReports])
  const unreadMine = useMemo(
    () =>
      snapshot.incidents.filter((i) => myIds.has(i.id) && seen[i.id] !== undefined && seen[i.id] !== citizenSignature(i)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [snapshot.incidents, myIds, seen],
  )
  const markSeen = useCallback(
    (ids: Iterable<string>) => {
      setSeen((prev) => {
        const next = { ...prev }
        for (const id of ids) {
          const inc = latest.current.snapshot.incidents.find((i) => i.id === id)
          if (inc) next[id] = citizenSignature(inc)
        }
        saveSeen(next)
        return next
      })
    },
    [],
  )
  const openMine = useCallback(
    (id: string | null = null) => {
      setMineOpen({ id })
      markSeen(myIds)
    },
    [markSeen, myIds],
  )
  // Selama panel terbuka, kabar baru langsung terbaca
  useEffect(() => {
    if (mineOpen && unreadMine.length > 0) markSeen(unreadMine.map((i) => i.id))
  }, [mineOpen, unreadMine, markSeen])

  const select = useCallback(
    (id: string) => {
      const { snapshot, layers, mobile } = latest.current
      const inc = snapshot.incidents.find((i) => i.id === id)
      setSelectedId(id)
      if (inc) {
        flyTo(inc)
        // Pastikan jenisnya terlihat di peta
        if (!layers.hazards[inc.type]) setLayers((l) => ({ ...l, hazards: { ...l.hazards, [inc.type]: true } }))
      }
      if (mobile) setSheetExpanded(true)
    },
    [flyTo],
  )

  // Dibuka dari dashboard dengan ?incident=ID: pilih kejadian itu begitu datanya tersedia
  const pendingId = useRef(new URLSearchParams(location.search).get('incident'))
  useEffect(() => {
    const id = pendingId.current
    if (id && snapshot.incidents.some((i) => i.id === id)) {
      pendingId.current = null
      select(id)
    }
  }, [snapshot.incidents, select])

  const selectCamera = useCallback(
    (id: string) => {
      const { snapshot, mobile } = latest.current
      const cam = snapshot.cameras.find((c) => c.id === id)
      setCameraId(id)
      setWallOpen(false)
      if (cam) setFocus({ lat: cam.lat, lng: cam.lng, zoom: 12, key: Date.now() })
      if (mobile) setSheetExpanded(false)
    },
    [],
  )
  const closeCamera = useCallback(() => setCameraId(null), [])
  const closeWall = useCallback(() => setWallOpen(false), [])

  const submitReport = async (r: ReportInput) => {
    const inc = await live.submitReport(r)
    setSeen((prev) => {
      const next = { ...prev, [inc.id]: citizenSignature(inc) }
      saveSeen(next)
      return next
    })
    setReportOpen(false)
    setPicked(null)
    select(inc.id)
  }

  const panelHeader = (
    <div className="flex h-11 items-center justify-between border-b border-line px-4">
      <h2 className="sign text-[14px]">{operator ? 'Antrean operator' : 'Kejadian aktif'}</h2>
      <span className="text-xs text-muted-fg tabular">
        {operator && stats.review > 0 && <span className="text-sev-medium">{stats.review} butuh validasi, </span>}
        {visible.length} ditampilkan
      </span>
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
      operator={operator}
      autoMin={snapshot.meta?.auto_dispatch_min}
      snapshot={snapshot}
      offline={live.offline}
      myReportIds={operator ? undefined : myIds}
      onOpenMine={(id) => openMine(id)}
    />
  )

  const layerPanel = (
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
      hotspots={{ mode: hotspotMode, meta: snapshot.hotspot_meta, count: satellite.points.length, loading: satellite.loading, failed: satellite.failed }}
      onTriggerDemo={() => {
        void live.triggerDemo()
        if (mobile) setLayersOpen(false)
      }}
    />
  )

  return (
    <MotionConfig reducedMotion="user">
      <a href="#incident-panel" className="sr-only-focusable fixed left-3 top-3 z-[60] bg-fg px-3 py-2 text-sm font-semibold text-bg">
        Lompat ke daftar kejadian
      </a>

      <main className="relative h-full w-full">
        {/* Lapisan UI kaca di atas peta penuh: top bar, lalu [rail layer | area peta | feed/detail] */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-2 p-2 min-[900px]:gap-3 min-[900px]:p-3">
          <div className="pointer-events-auto">
            <TopBar
              connection={live.connection}
              lastUpdate={live.lastUpdate}
              stats={stats}
              onReport={() => setReportOpen(true)}
              operator={operator}
              wallOpen={wallOpen}
              onToggleWall={() => setWallOpen((v) => !v)}
              myReports={operator ? undefined : { count: live.myReports.length, unread: unreadMine.length, onOpen: () => openMine() }}
            />
          </div>

          <AnimatePresence initial={false}>
            {live.offline && (
              <motion.div
                key="offline"
                role="status"
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0, transition: { duration: 0.15 } }}
                className="pointer-events-auto shrink-0 overflow-hidden rounded-xl border border-[#6B4E0E] bg-[#3A2A06]/70 backdrop-blur-xl"
              >
                <p className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[#FDE68A]">
                  <WifiOff size={14} aria-hidden />
                  <span className="sign text-[13px]">Mode offline</span>
                  Server tidak terjangkau. Menampilkan data demo dan simulator lokal.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative flex min-h-0 flex-1 gap-3">
            {!mobile && layerPanel}

            {/* Area peta yang terlihat: toast, tombol mobile, banner pilih lokasi */}
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-[3.25rem] z-20 flex justify-center min-[900px]:top-3 min-[900px]:px-3">
                <div className="flex flex-col items-center gap-2">
                  <AnimatePresence>
                    {!operator && !mineOpen && unreadMine.length > 0 && (
                      <motion.button
                        key="mine-news"
                        type="button"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.12 } }}
                        onClick={() => openMine(unreadMine[0].id)}
                        className="glass-strong pointer-events-auto flex items-center gap-2.5 rounded-full border-[#38BDF8]/60 px-4 py-2 text-sm"
                        role="status"
                      >
                        <MessageCircle size={16} className="text-[#38BDF8]" aria-hidden />
                        <span>
                          <span className="font-semibold">Ada kabar dari operator 112</span> untuk laporan Anda
                        </span>
                        <span className="sign text-[12px] text-[#38BDF8]">Buka</span>
                      </motion.button>
                    )}
                  </AnimatePresence>
                  <Toasts toasts={live.newCritical} onOpen={select} onDismiss={live.dismissToast} />
                </div>
              </div>

              {mobile && (
                <div className="absolute left-0 top-0 z-10 flex items-center gap-2">
                  {layerPanel}
                  {!operator && (
                    <button
                      type="button"
                      onClick={() => setReportOpen(true)}
                      className="glass pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold sm:hidden"
                    >
                      <Megaphone size={16} aria-hidden /> Lapor
                    </button>
                  )}
                  {!operator && live.myReports.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openMine()}
                      aria-label={`Laporan saya${unreadMine.length ? `, ${unreadMine.length} kabar baru` : ''}`}
                      className="glass pointer-events-auto relative grid h-11 w-11 place-items-center rounded-xl sm:hidden"
                    >
                      <Inbox size={17} aria-hidden />
                      {unreadMine.length > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#38BDF8]" aria-hidden />}
                    </button>
                  )}
                </div>
              )}

              <AnimatePresence>
                {camera && !wallOpen && (
                  <div
                    key="camera"
                    className="pointer-events-none absolute left-0 right-0 top-[3.25rem] z-20 flex min-[900px]:bottom-0 min-[900px]:left-auto min-[900px]:right-0 min-[900px]:top-auto min-[900px]:w-[400px] min-[900px]:items-end"
                  >
                    <CameraViewer camera={camera} incidents={active} onClose={closeCamera} onSelectIncident={select} />
                  </div>
                )}
                {wallOpen && (
                  <div key="wall" className="absolute inset-0 z-30">
                    <VideoWall cameras={snapshot.cameras} onClose={closeWall} onLocate={selectCamera} />
                  </div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {pickMode && (
                  <motion.div
                    key="pick"
                    role="status"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    className="glass-strong pointer-events-auto absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold"
                  >
                    <MapPin size={16} aria-hidden /> Klik peta untuk memilih lokasi kejadian
                    <button type="button" onClick={() => setPickMode(false)} className="text-dim underline underline-offset-2 hover:text-fg">
                      Batal
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {!mobile && (
              <aside
                id="incident-panel"
                aria-label="Feed dan detail kejadian"
                className={`glass scroll-thin pointer-events-auto min-h-0 shrink-0 overflow-y-auto rounded-2xl ${wide ? 'w-[400px]' : 'w-[350px]'}`}
              >
                {panel}
              </aside>
            )}
          </div>
        </div>

        {/* Peta penuh di belakang; di akhir urutan DOM supaya Tab mencapai kontrol UI lebih dulu */}
        <div className="absolute inset-0 z-0">
          <MapView
            incidents={visible}
            zones={zones}
            routes={routes}
            cameras={cameras}
            heat={heat}
            selectedId={selectedId}
            onSelect={select}
            selectedCameraId={cameraId}
            onSelectCamera={selectCamera}
            focus={focus}
            pickMode={pickMode}
            picked={reportOpen || pickMode ? picked : null}
            onPick={(lat, lng) => {
              setPicked({ lat, lng })
              setPickMode(false)
            }}
          />
        </div>

        {mobile && (
          <div id="incident-panel" className="pointer-events-none fixed inset-0 z-20">
            <BottomSheet
              expanded={sheetExpanded}
              setExpanded={setSheetExpanded}
              summary={
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="sign text-[15px]">Kejadian aktif</h2>
                  <div className="flex items-baseline gap-3 text-[13px] tabular">
                    <span>{stats.active} aktif</span>
                    <span className="text-sev-critical">{stats.critical} kritis</span>
                    {operator ? (
                      <span className="text-sev-medium">{stats.review} validasi</span>
                    ) : (
                      <span className="text-accent">{stats.dispatched} dikirim</span>
                    )}
                  </div>
                </div>
              }
            >
              {panel}
            </BottomSheet>
          </div>
        )}

        <AnimatePresence>
          {mineOpen && (
            <MyReports
              key="mine"
              reports={live.myReports}
              incidents={snapshot.incidents}
              openId={mineOpen.id}
              onReply={live.replyReport}
              onLocate={(id) => {
                setMineOpen(null)
                select(id)
              }}
              onClose={() => setMineOpen(null)}
            />
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
