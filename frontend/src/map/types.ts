import type { Camera, Incident, Route, Zone } from '../types'
import type { HeatPoint } from '../lib/hotspots'

export interface FocusTarget {
  lat: number
  lng: number
  /** Zoom minimum. Kalau peta sudah lebih dekat, zoom-nya tidak diubah, hanya digeser. */
  zoom: number
  key: number
}

export interface MapProps {
  incidents: Incident[]
  zones: Zone[]
  routes: Route[]
  cameras: Camera[]
  /** Titik heatmap kebakaran. Kosong = layer heatmap mati */
  heat: HeatPoint[]
  selectedId: string | null
  onSelect: (id: string) => void
  selectedCameraId: string | null
  onSelectCamera: (id: string) => void
  focus: FocusTarget | null
  pickMode: boolean
  picked: { lat: number; lng: number } | null
  onPick: (lat: number, lng: number) => void
}
