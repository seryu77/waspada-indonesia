import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { APIProvider, AdvancedMarker, Circle, ColorScheme, InfoWindow, Map, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps'
import type { MapProps } from './types'
import { INDONESIA_BOUNDS, INDONESIA_CENTER, fitPadding, fitZoomBox } from '../lib/bounds'
import { ROUTES, SEVERITY, ZONES } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { IncidentMarker } from './markers/IncidentMarker'
import { CameraMarker } from './markers/CameraMarker'
import { CameraClusterMarker } from './markers/CameraClusterMarker'
import { CLUSTER_ZOOM_TO, layoutCameras, type MapViewport } from '../lib/cameraLayout'
import { hasStream } from '../lib/camera'
import { PickedMarker } from './markers/PickedMarker'
import { routeText, zoneText } from './overlayText'
import { HeatRenderer, heatRadius } from './heat'
import type { HeatPoint } from '../lib/hotspots'
import { useMedia } from '../lib/hooks'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAP_ID as string) || 'DEMO_MAP_ID'

function Controller({ focus }: Pick<MapProps, 'focus'>) {
  const map = useMap()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!map || !focus) return
    const center = { lat: focus.lat, lng: focus.lng }
    // focus.zoom adalah zoom minimum: kalau pengguna sudah zoom lebih dekat, jangan ditarik mundur
    const zoom = Math.max(map.getZoom() ?? 0, focus.zoom)
    if (reduce) {
      map.moveCamera({ center, zoom })
      return
    }
    // Zoom baru dijalankan setelah geser selesai. Kalau zoom memotong animasi geser,
    // peta ter-zoom di titik tengah perjalanan, bukan di pinpoint yang dipilih.
    let done = false
    const go = () => {
      if (done) return
      done = true
      map.moveCamera({ center, zoom })
    }
    map.panTo(center)
    const idle = google.maps.event.addListenerOnce(map, 'idle', go)
    // Cadangan: kalau peta sudah di titik itu, panTo tidak bergerak dan 'idle' bisa tidak terpicu
    const t = window.setTimeout(go, 1200)
    return () => {
      done = true
      idle.remove()
      window.clearTimeout(t)
    }
  }, [map, focus, reduce])
  return null
}

// Tengah peta harus tetap di atas Indonesia. Tidak strict, supaya layar mana pun (termasuk HP potret)
// bisa zoom out sampai seluruh Indonesia terlihat; batas zoom out diatur minZoom di Fitter.
const RESTRICTION = { latLngBounds: INDONESIA_BOUNDS, strictBounds: false }

/** Tampilkan seluruh Indonesia di area yang tidak tertutup panel, lalu kunci zoom minimum di situ. */
function Fitter() {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const fit = (initial: boolean) => {
      const { tl, br } = fitPadding()
      const div = map.getDiv()
      const z = fitZoomBox(div.clientWidth - tl[0] - br[0], div.clientHeight - tl[1] - br[1])
      map.setOptions({ minZoom: Math.max(3, Math.floor(z * 10) / 10 - 0.2) })
      if (initial) map.fitBounds(INDONESIA_BOUNDS, { left: tl[0], top: tl[1], right: br[0], bottom: br[1] })
    }
    fit(true)
    const onResize = () => fit(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [map])
  return null
}

/**
 * Kamera digabung per kota saat zoom jauh, dan hanya yang terlihat di layar saat zoom dekat.
 * Posisi peta dibaca saat 'idle' (selesai bergerak), jadi tidak render ulang di tiap frame geser.
 */
function CameraLayer({ cameras, selectedCameraId, onSelectCamera }: Pick<MapProps, 'cameras' | 'selectedCameraId' | 'onSelectCamera'>) {
  const map = useMap()
  const [view, setView] = useState<MapViewport>({ zoom: 0, bounds: null })
  useEffect(() => {
    if (!map) return
    const read = () => setView({ zoom: map.getZoom() ?? 0, bounds: map.getBounds()?.toJSON() ?? null })
    const l = map.addListener('idle', read)
    return () => l.remove()
  }, [map])
  const { clusters, singles } = useMemo(() => layoutCameras(cameras, view, selectedCameraId, hasStream), [cameras, view, selectedCameraId])
  return (
    <>
      {clusters.map((g) => (
        <AdvancedMarker key={`g-${g.key}`} position={{ lat: g.lat, lng: g.lng }} zIndex={2} clickable anchorLeft="-50%" anchorTop="-50%">
          <CameraClusterMarker cluster={g} onZoom={(c) => map?.moveCamera({ center: { lat: c.lat, lng: c.lng }, zoom: CLUSTER_ZOOM_TO })} />
        </AdvancedMarker>
      ))}
      {singles.map((c) => (
        <AdvancedMarker key={c.id} position={{ lat: c.lat, lng: c.lng }} zIndex={1} clickable anchorLeft="-50%" anchorTop="-50%">
          <CameraMarker camera={c} selected={selectedCameraId === c.id} onSelect={onSelectCamera} />
        </AdvancedMarker>
      ))}
    </>
  )
}

/**
 * Heatmap sebagai OverlayView di pane overlayLayer (di bawah marker). Google Maps sudah mencabut
 * HeatmapLayer bawaannya, jadi pakai renderer canvas yang sama dengan Leaflet.
 */
function HeatLayer({ points }: { points: HeatPoint[] }) {
  const map = useMap()
  const pointsRef = useRef(points)
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!map) return
    const heat = new HeatRenderer()
    let frame = 0
    const overlay = new google.maps.OverlayView()
    const render = () => {
      frame = 0
      const proj = overlay.getProjection()
      if (!proj) return
      const div = map.getDiv()
      const w = div.clientWidth
      const h = div.clientHeight
      // Letakkan canvas tepat di pojok kiri atas layar, dalam koordinat pane
      const corner = proj.fromContainerPixelToLatLng(new google.maps.Point(0, 0))
      const origin = corner && proj.fromLatLngToDivPixel(corner)
      if (!origin) return
      heat.canvas.style.left = `${origin.x}px`
      heat.canvas.style.top = `${origin.y}px`
      const pts: [number, number, number, number?][] = []
      for (const [lat, lng, wt, live] of pointsRef.current) {
        const p = proj.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lng))
        if (p) pts.push([p.x, p.y, wt, live])
      }
      heat.draw(w, h, pts, heatRadius(map.getZoom() ?? 5))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render)
    }
    overlay.onAdd = () => overlay.getPanes()?.overlayLayer.appendChild(heat.canvas)
    overlay.draw = schedule
    overlay.onRemove = () => heat.canvas.remove()
    overlay.setMap(map)
    const idle = map.addListener('idle', schedule)
    redrawRef.current = schedule
    return () => {
      cancelAnimationFrame(frame)
      idle.remove()
      overlay.setMap(null)
      redrawRef.current = () => {}
    }
  }, [map])

  useEffect(() => {
    pointsRef.current = points
    redrawRef.current()
  }, [points])
  return null
}

const dashIcons = (color: string) => [
  { icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: color, scale: 4 }, offset: '0', repeat: '16px' },
]

export default function GoogleMapView(p: MapProps) {
  const mobile = !useMedia('(min-width: 900px)')
  const [info, setInfo] = useState<{ pos: google.maps.LatLngLiteral; text: string } | null>(null)

  return (
    <APIProvider apiKey={KEY} language="id" region="ID">
      <Map
        mapId={MAP_ID}
        colorScheme={ColorScheme.DARK}
        defaultCenter={INDONESIA_CENTER}
        defaultZoom={4}
        // Sampai level jalan, supaya posisi CCTV dan kejadian bisa dilihat persis
        maxZoom={20}
        isFractionalZoomEnabled
        restriction={RESTRICTION}
        disableDefaultUI
        // Di layar kecil tombol zoom tertimpa bottom sheet; cukup pakai cubit dua jari
        zoomControl={!mobile}
        gestureHandling="greedy"
        clickableIcons={false}
        draggableCursor={p.pickMode ? 'crosshair' : undefined}
        onClick={(e) => {
          setInfo(null)
          const ll = e.detail.latLng
          if (p.pickMode && ll) p.onPick(ll.lat, ll.lng)
        }}
        className="h-full w-full"
      >
        <Controller focus={p.focus} />
        <Fitter />

        {p.zones.map((z) => {
          const s = ZONES[z.kind]
          const common = {
            strokeColor: s.stroke,
            strokeWeight: 1.5,
            fillColor: s.fill,
            fillOpacity: s.fillOpacity,
            onClick: (e: google.maps.MapMouseEvent) => e.latLng && setInfo({ pos: e.latLng.toJSON(), text: zoneText(z) }),
          }
          return z.shape === 'circle' && z.center ? (
            <Circle key={z.id} center={{ lat: z.center[0], lng: z.center[1] }} radius={z.radius_m ?? 1000} {...common} />
          ) : (
            <Polygon key={z.id} paths={[(z.coords ?? []).map(([lat, lng]) => ({ lat, lng }))]} {...common} />
          )
        })}

        {p.routes.map((r) => {
          const style = ROUTES[r.kind]
          return (
            <Polyline
              key={r.id}
              path={r.path.map(([lat, lng]) => ({ lat, lng }))}
              strokeColor={style.color}
              strokeWeight={5}
              strokeOpacity={style.dash ? 0 : 0.95}
              icons={style.dash ? dashIcons(style.color) : undefined}
              onClick={(e) => e.latLng && setInfo({ pos: e.latLng.toJSON(), text: routeText(r) })}
            />
          )
        })}

        {p.heat.length > 0 && <HeatLayer points={p.heat} />}

        <CameraLayer cameras={p.cameras} selectedCameraId={p.selectedCameraId} onSelectCamera={p.onSelectCamera} />

        {p.incidents.map((i) => (
          <AdvancedMarker
            key={i.id}
            position={{ lat: i.lat, lng: i.lng }}
            zIndex={SEVERITY[effectiveSeverity(i)].rank * 10 + (p.selectedId === i.id ? 100 : 0)}
            // Tanpa ini library mematikan pointer-events konten marker, jadi tombol di dalamnya tidak bisa diklik
            clickable
            anchorLeft="-50%"
            anchorTop="-50%"
          >
            <IncidentMarker incident={i} selected={p.selectedId === i.id} onSelect={p.onSelect} />
          </AdvancedMarker>
        ))}

        {p.picked && (
          <AdvancedMarker position={p.picked} zIndex={500}>
            <PickedMarker />
          </AdvancedMarker>
        )}

        {info && (
          <InfoWindow position={info.pos} onCloseClick={() => setInfo(null)} headerDisabled>
            <p style={{ color: '#0F172A', maxWidth: 240, fontSize: 12, margin: 0 }}>{info.text}</p>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  )
}
