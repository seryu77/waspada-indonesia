import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useReducedMotion } from 'motion/react'
import type { MapProps } from './types'
import { INDONESIA_BOUNDS, fitPadding } from '../lib/bounds'
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

// Tile gelap gratis tanpa key yang jalan di domain mana pun (CARTO). Stadia butuh domain terdaftar,
// di domain publik hasilnya 401. Bisa diganti lewat VITE_TILE_URL.
const TILE_URL =
  (import.meta.env.VITE_TILE_URL as string) || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

// Sampai level jalan (tile CARTO tersedia hingga zoom 20)
const MAX_ZOOM = 20

const BOUNDS = L.latLngBounds([INDONESIA_BOUNDS.south, INDONESIA_BOUNDS.west], [INDONESIA_BOUNDS.north, INDONESIA_BOUNDS.east])

/** Marker Leaflet yang isinya komponen React (supaya bisa pakai motion dan fokus keyboard). */
function ReactMarker({ lat, lng, z = 0, children }: { lat: number; lng: number; z?: number; children: ReactNode }) {
  const el = useMemo(() => document.createElement('div'), [])
  const icon = useMemo(() => L.divIcon({ html: el, className: 'wn-marker', iconSize: [0, 0] }), [el])
  return (
    <>
      <Marker position={[lat, lng]} icon={icon} keyboard={false} zIndexOffset={z} />
      {createPortal(<div style={{ position: 'absolute', transform: 'translate(-50%, -50%)' }}>{children}</div>, el)}
    </>
  )
}

function Controller({ focus, pickMode, onPick }: Pick<MapProps, 'focus' | 'pickMode' | 'onPick'>) {
  const map = useMap()
  const reduce = useReducedMotion()
  useEffect(() => {
    // Akses peta dari console saat development (debug)
    if (import.meta.env.DEV) Object.assign(window, { __wnMap: map })
  }, [map])

  // Tampilkan seluruh Indonesia di area peta yang tidak tertutup panel, lalu kunci zoom minimum
  useEffect(() => {
    const fit = (initial: boolean) => {
      const pad = fitPadding()
      const z = map.getBoundsZoom(BOUNDS, false, L.point(pad.tl[0] + pad.br[0], pad.tl[1] + pad.br[1]))
      map.setMinZoom(Math.max(3, Math.floor(z * 10) / 10 - 0.2))
      if (initial) map.fitBounds(BOUNDS, { paddingTopLeft: pad.tl, paddingBottomRight: pad.br, animate: false })
    }
    fit(true)
    const onResize = () => fit(false)
    map.on('resize', onResize)
    // Kolom peta berubah lebar saat rail layer dibuka/diciutkan
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    ro.observe(map.getContainer())
    return () => {
      map.off('resize', onResize)
      ro.disconnect()
    }
  }, [map])

  useEffect(() => {
    if (!focus) return
    // focus.zoom adalah zoom minimum: kalau pengguna sudah zoom lebih dekat, jangan ditarik mundur
    const zoom = Math.max(map.getZoom(), focus.zoom)
    if (reduce) map.setView([focus.lat, focus.lng], zoom)
    else if (zoom === map.getZoom()) map.panTo([focus.lat, focus.lng], { duration: 0.6 })
    else map.flyTo([focus.lat, focus.lng], zoom, { duration: 1.1 })
  }, [focus, map, reduce])

  useEffect(() => {
    map.getContainer().style.cursor = pickMode ? 'crosshair' : ''
  }, [map, pickMode])

  useMapEvents({
    click(e) {
      if (pickMode) onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/** Kamera digabung per kota saat zoom jauh, dan hanya yang terlihat di layar saat zoom dekat. */
function CameraLayer({ cameras, selectedCameraId, onSelectCamera }: Pick<MapProps, 'cameras' | 'selectedCameraId' | 'onSelectCamera'>) {
  const map = useMap()
  const read = (): MapViewport => {
    const b = map.getBounds()
    return { zoom: map.getZoom(), bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() } }
  }
  const [view, setView] = useState<MapViewport>(read)
  useMapEvents({ moveend: () => setView(read()) })
  const { clusters, singles } = useMemo(() => layoutCameras(cameras, view, selectedCameraId, hasStream), [cameras, view, selectedCameraId])
  return (
    <>
      {clusters.map((g) => (
        <ReactMarker key={`g-${g.key}`} lat={g.lat} lng={g.lng} z={-50}>
          <CameraClusterMarker cluster={g} onZoom={(c) => map.flyTo([c.lat, c.lng], CLUSTER_ZOOM_TO, { duration: 0.8 })} />
        </ReactMarker>
      ))}
      {singles.map((c) => (
        <ReactMarker key={c.id} lat={c.lat} lng={c.lng} z={-100}>
          <CameraMarker camera={c} selected={selectedCameraId === c.id} onSelect={onSelectCamera} />
        </ReactMarker>
      ))}
    </>
  )
}

/** Heatmap di pane sendiri, di bawah marker. Digambar ulang setelah peta selesai bergerak. */
function HeatLayer({ points }: { points: HeatPoint[] }) {
  const map = useMap()
  const pointsRef = useRef(points)
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const pane = map.getPane('wnHeat') ?? map.createPane('wnHeat')
    pane.style.zIndex = '350'
    pane.style.pointerEvents = 'none'
    const heat = new HeatRenderer()
    // Disembunyikan selama animasi zoom, lalu digambar ulang di zoomend
    heat.canvas.classList.add('leaflet-zoom-hide')
    pane.appendChild(heat.canvas)
    const redraw = () => {
      const size = map.getSize()
      L.DomUtil.setPosition(heat.canvas, map.containerPointToLayerPoint([0, 0]))
      const pts = pointsRef.current.map(([lat, lng, w, live]): [number, number, number, number?] => {
        const p = map.latLngToContainerPoint([lat, lng])
        return [p.x, p.y, w, live]
      })
      heat.draw(size.x, size.y, pts, heatRadius(map.getZoom()))
    }
    redrawRef.current = redraw
    redraw()
    map.on('moveend zoomend resize', redraw)
    return () => {
      map.off('moveend zoomend resize', redraw)
      heat.canvas.remove()
      redrawRef.current = () => {}
    }
  }, [map])

  useEffect(() => {
    pointsRef.current = points
    redrawRef.current()
  }, [points])
  return null
}

export default function LeafletMapView(p: MapProps) {
  return (
    <MapContainer
      bounds={BOUNDS}
      maxBounds={BOUNDS.pad(0.6)}
      maxBoundsViscosity={1}
      zoomSnap={0.1}
      maxZoom={MAX_ZOOM}
      preferCanvas
      zoomDelta={0.5}
      zoomControl={false}
      worldCopyJump={false}
      className="h-full w-full"
      attributionControl
    >
      <TileLayer
        url={TILE_URL}
        attribution={TILE_ATTRIBUTION}
        maxZoom={MAX_ZOOM}
        // Di atas 18 tile diperbesar dari zoom 18, jadi tidak muncul kotak kosong
        maxNativeZoom={18}
        detectRetina={false}
        updateWhenIdle
        updateWhenZooming={false}
        keepBuffer={1}
      />
      <Controller focus={p.focus} pickMode={p.pickMode} onPick={p.onPick} />

      {p.zones.map((z) => {
        const s = ZONES[z.kind]
        const opts = { color: s.stroke, weight: 1.5, fillColor: s.fill, fillOpacity: s.fillOpacity, dashArray: s.dash }
        const tip = (
          <Tooltip sticky className="wn-tooltip">
            {zoneText(z)}
          </Tooltip>
        )
        return z.shape === 'circle' && z.center ? (
          <Circle key={z.id} center={z.center} radius={z.radius_m ?? 1000} pathOptions={opts}>
            {tip}
          </Circle>
        ) : (
          <Polygon key={z.id} positions={z.coords ?? []} pathOptions={opts}>
            {tip}
          </Polygon>
        )
      })}

      {p.routes.map((r) => (
        <Polyline
          key={r.id}
          positions={r.path}
          pathOptions={{ color: ROUTES[r.kind].color, weight: 5, opacity: 0.95, dashArray: ROUTES[r.kind].dash, lineCap: 'round' }}
        >
          <Tooltip sticky className="wn-tooltip">
            {routeText(r)}
          </Tooltip>
        </Polyline>
      ))}

      {p.heat.length > 0 && <HeatLayer points={p.heat} />}

      <CameraLayer cameras={p.cameras} selectedCameraId={p.selectedCameraId} onSelectCamera={p.onSelectCamera} />

      {p.incidents.map((i) => (
        <ReactMarker key={i.id} lat={i.lat} lng={i.lng} z={SEVERITY[effectiveSeverity(i)].rank * 100 + (p.selectedId === i.id ? 1000 : 0)}>
          <IncidentMarker incident={i} selected={p.selectedId === i.id} onSelect={p.onSelect} />
        </ReactMarker>
      ))}

      {p.picked && (
        <ReactMarker lat={p.picked.lat} lng={p.picked.lng} z={2000}>
          <PickedMarker />
        </ReactMarker>
      )}
    </MapContainer>
  )
}
