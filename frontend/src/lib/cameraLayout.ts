import type { Camera } from '../types'

/** Di bawah zoom ini kamera digabung per kota, supaya peta tidak menggambar ratusan marker. */
export const CLUSTER_BELOW_ZOOM = 10
/** Zoom saat penanda kota diklik */
export const CLUSTER_ZOOM_TO = 12

export interface MapViewport {
  zoom: number
  bounds: { north: number; south: number; east: number; west: number } | null
}

export interface CameraCluster {
  key: string
  city: string
  lat: number
  lng: number
  count: number
  live: number
}

/**
 * Zoom jauh: satu penanda per kota (rata-rata posisi kamera). Zoom dekat: kamera satu per satu,
 * hanya yang ada di layar (plus sedikit margin). Kamera yang sedang dipilih selalu tampil.
 */
export function layoutCameras(
  cameras: Camera[],
  view: MapViewport,
  selectedId: string | null,
  isLive: (c: Camera) => boolean,
): { clusters: CameraCluster[]; singles: Camera[] } {
  if (view.zoom < CLUSTER_BELOW_ZOOM) {
    const groups = new Map<string, Camera[]>()
    for (const c of cameras) {
      if (c.id === selectedId) continue
      const g = groups.get(c.city)
      if (g) g.push(c)
      else groups.set(c.city, [c])
    }
    const clusters = [...groups].map(([city, list]) => ({
      key: city,
      city,
      lat: list.reduce((s, c) => s + c.lat, 0) / list.length,
      lng: list.reduce((s, c) => s + c.lng, 0) / list.length,
      count: list.length,
      live: list.filter(isLive).length,
    }))
    return { clusters, singles: cameras.filter((c) => c.id === selectedId) }
  }
  const b = view.bounds
  if (!b) return { clusters: [], singles: cameras }
  const padLat = (b.north - b.south) * 0.2
  const padLng = (b.east - b.west) * 0.2
  const singles = cameras.filter(
    (c) =>
      c.id === selectedId ||
      (c.lat <= b.north + padLat && c.lat >= b.south - padLat && c.lng <= b.east + padLng && c.lng >= b.west - padLng),
  )
  return { clusters: [], singles }
}
