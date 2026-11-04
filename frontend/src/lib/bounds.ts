// Batas peta: hanya wilayah Indonesia
export const INDONESIA_BOUNDS = { north: 6.8, south: -11.8, west: 94.0, east: 141.8 }
export const INDONESIA_CENTER = { lat: -2.5, lng: 118.0 }

/** Zoom terkecil yang masih menampilkan seluruh Indonesia selebar viewport. */
export function fitZoom(widthPx: number): number {
  const lngSpan = INDONESIA_BOUNDS.east - INDONESIA_BOUNDS.west
  return Math.log2((widthPx * 360) / (lngSpan * 256))
}

/** Ruang yang tertutup panel kaca, diukur langsung dari DOM supaya Indonesia muat di area yang terlihat. */
export function fitPadding(): { tl: [number, number]; br: [number, number] } {
  const w = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.offsetWidth ?? 0
  const top = (document.querySelector('header') as HTMLElement | null)?.offsetHeight ?? 52
  if (window.innerWidth < 900) return { tl: [8, top + 56], br: [8, 100] }
  return { tl: [w('aside#layer-panel') + 28, top + 28], br: [w('aside#incident-panel') + 28, 28] }
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Zoom (pecahan) yang memuat seluruh Indonesia, lebar dan tinggi, di kotak w x h piksel. */
export function fitZoomBox(w: number, h: number): number {
  const b = INDONESIA_BOUNDS
  const zLng = Math.log2((w * 360) / ((b.east - b.west) * 256))
  const zLat = Math.log2((h * 2 * Math.PI) / ((mercY(b.north) - mercY(b.south)) * 256))
  return Math.min(zLng, zLat)
}
