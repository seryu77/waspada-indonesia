import { lazy, Suspense } from 'react'
import type { MapProps } from './types'
import { hasGoogleKey } from './engine'

const GoogleMapView = lazy(() => import('./GoogleMapView'))
const LeafletMapView = lazy(() => import('./LeafletMapView'))

export function MapView(props: MapProps) {
  return (
    <Suspense fallback={<div className="h-full w-full bg-bg" aria-busy="true" />}>
      {hasGoogleKey ? <GoogleMapView {...props} /> : <LeafletMapView {...props} />}
    </Suspense>
  )
}
