import type { Camera, Incident, Route, Zone } from '../types'

export interface FocusTarget {
  lat: number
  lng: number
  zoom: number
  key: number
}

export interface MapProps {
  incidents: Incident[]
  zones: Zone[]
  routes: Route[]
  cameras: Camera[]
  selectedId: string | null
  onSelect: (id: string) => void
  focus: FocusTarget | null
  pickMode: boolean
  picked: { lat: number; lng: number } | null
  onPick: (lat: number, lng: number) => void
}
