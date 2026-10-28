import { lazy, Suspense } from 'react'
import type { MapProps } from './types'

const hasGoogleKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
const GoogleMapView = lazy(() => import('./GoogleMapView'))
const LeafletMapView = lazy(() => import('./LeafletMapView'))

export const MAP_ENGINE = hasGoogleKey ? 'Google Maps' : 'Leaflet + Stadia (OSM)'

export function MapView(props: MapProps) {
  return (
    <Suspense fallback={<div className="h-full w-full bg-bg" aria-busy="true" />}>
      {hasGoogleKey ? <GoogleMapView {...props} /> : <LeafletMapView {...props} />}
    </Suspense>
  )
}
