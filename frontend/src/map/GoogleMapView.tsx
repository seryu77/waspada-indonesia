import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { APIProvider, AdvancedMarker, Circle, ColorScheme, InfoWindow, Map, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps'
import type { MapProps } from './types'
import { INDONESIA_BOUNDS, INDONESIA_CENTER, fitZoom } from '../lib/bounds'
import { ROUTES, SEVERITY, ZONES } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { IncidentMarker } from './markers/IncidentMarker'
import { CameraMarker } from './markers/CameraMarker'
import { PickedMarker } from './markers/PickedMarker'
import { routeText, zoneText } from './overlayText'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAP_ID as string) || 'DEMO_MAP_ID'

function Controller({ focus }: Pick<MapProps, 'focus'>) {
  const map = useMap()
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!map || !focus) return
    map.panTo({ lat: focus.lat, lng: focus.lng })
    if (reduce) map.setZoom(focus.zoom)
    else window.setTimeout(() => map.setZoom(focus.zoom), 300)
  }, [map, focus, reduce])
  return null
}

const dashIcons = (color: string) => [
  { icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: color, scale: 4 }, offset: '0', repeat: '16px' },
]

export default function GoogleMapView(p: MapProps) {
  const [info, setInfo] = useState<{ pos: google.maps.LatLngLiteral; text: string } | null>(null)
  const zoom0 = Math.max(3, fitZoom(window.innerWidth))

  return (
    <APIProvider apiKey={KEY} language="id" region="ID">
      <Map
        mapId={MAP_ID}
        colorScheme={ColorScheme.DARK}
        defaultCenter={INDONESIA_CENTER}
        defaultZoom={zoom0}
        minZoom={Math.floor(zoom0)}
        maxZoom={12}
        restriction={{ latLngBounds: INDONESIA_BOUNDS, strictBounds: true }}
        disableDefaultUI
        zoomControl
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

        {p.cameras.map((c) => (
          <AdvancedMarker key={c.id} position={{ lat: c.lat, lng: c.lng }} zIndex={1} anchorLeft="-50%" anchorTop="-50%">
            <CameraMarker camera={c} />
          </AdvancedMarker>
        ))}

        {p.incidents.map((i) => (
          <AdvancedMarker
            key={i.id}
            position={{ lat: i.lat, lng: i.lng }}
            zIndex={SEVERITY[effectiveSeverity(i)].rank * 10 + (p.selectedId === i.id ? 100 : 0)}
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
