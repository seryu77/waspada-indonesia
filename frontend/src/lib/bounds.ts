// Batas peta: hanya wilayah Indonesia
export const INDONESIA_BOUNDS = { north: 6.8, south: -11.8, west: 94.0, east: 141.8 }
export const INDONESIA_CENTER = { lat: -2.5, lng: 118.0 }

/** Zoom terkecil yang masih menampilkan seluruh Indonesia selebar viewport. */
export function fitZoom(widthPx: number): number {
  const lngSpan = INDONESIA_BOUNDS.east - INDONESIA_BOUNDS.west
  return Math.log2((widthPx * 360) / (lngSpan * 256))
}
