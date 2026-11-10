import type { Hotspot, Incident, Severity } from '../types'

/**
 * Titik siap gambar: [lat, lng, bobot 0-1, live]. live = 1 untuk kebakaran dari CCTV/warga:
 * kecerahannya tidak ikut diredam saat titik satelit di layar sangat padat.
 */
export type HeatPoint = [number, number, number, number?]

const HOUR = 3600_000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Bobot titik satelit: makin besar FRP makin panas, lalu memudar dalam 48 jam. */
export function hotspotWeight(frp: number, ageMs: number) {
  const power = clamp(Math.log1p(frp) / Math.log1p(150), 0.15, 1)
  const fade = ageMs <= 3 * HOUR ? 1 : clamp(1 - (ageMs - 3 * HOUR) / (45 * HOUR), 0.15, 1)
  return power * fade
}

const SEVERITY_HEAT: Record<Severity, number> = { critical: 1, high: 0.85, medium: 0.65, low: 0.45 }

/**
 * Kebakaran dari CCTV dan laporan warga masuk heatmap seketika lewat WebSocket.
 * Kluster satelit dilewati karena titik mentahnya sudah ada di heatmap.
 */
export function incidentHeat(incidents: Incident[], now: number): HeatPoint[] {
  const out: HeatPoint[] = []
  for (const i of incidents) {
    if (i.type !== 'fire' || i.status !== 'active' || i.source.kind === 'satellite') continue
    if (i.verification?.verdict === 'false_alarm') continue
    const age = now - Date.parse(i.reported_at)
    const fade = age <= HOUR ? 1 : clamp(1 - (age - HOUR) / (11 * HOUR), 0.3, 1)
    out.push([i.lat, i.lng, SEVERITY_HEAT[i.verification?.severity ?? i.severity] * fade, 1])
  }
  return out
}

export function satelliteHeat(hotspots: Hotspot[], now: number): HeatPoint[] {
  return hotspots.map(([lat, lng, frp, t]) => [lat, lng, hotspotWeight(frp, now - t * 1000)])
}

// ---- Data demo ----

/** Daerah rawan karhutla. w: peluang titik muncul di sini, spread: sebaran dalam derajat */
const DEMO_REGIONS = [
  { lat: -3.32, lng: 105.82, w: 5, spread: 0.18 }, // OKI, Sumatera Selatan
  { lat: -2.62, lng: 114.12, w: 5, spread: 0.2 }, // Pulang Pisau, Kalimantan Tengah
  { lat: 0.3, lng: 102.05, w: 3, spread: 0.22 }, // Pelalawan, Riau
  { lat: -1.61, lng: 103.61, w: 3, spread: 0.15 }, // Muaro Jambi, Jambi
  { lat: -1.85, lng: 110.3, w: 2, spread: 0.2 }, // Ketapang, Kalimantan Barat
  { lat: -2.95, lng: 104.75, w: 1.5, spread: 0.12 }, // Banyuasin, Sumatera Selatan
  { lat: -8.25, lng: 140.55, w: 1, spread: 0.25 }, // Merauke, Papua Selatan
  { lat: -9.65, lng: 120.1, w: 0.6, spread: 0.2 }, // Sumba Timur, NTT
]
const DEMO_TOTAL_W = DEMO_REGIONS.reduce((s, r) => s + r.w, 0)
const SLOT_MS = 3 * 60_000

/** PRNG kecil dengan seed, supaya semua browser melihat data demo yang sama */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Titik panas contoh untuk 48 jam terakhir. Tiap 3 menit muncul 1-2 titik baru, jadi heatmap
 * tetap hidup saat demo tanpa NASA_FIRMS_MAP_KEY. Hasilnya sama di semua browser.
 */
export function demoHotspots(now: number): Hotspot[] {
  const out: Hotspot[] = []
  const first = Math.floor((now - 48 * HOUR) / SLOT_MS)
  const last = Math.floor(now / SLOT_MS)
  for (let slot = first; slot <= last; slot++) {
    const r = rng(slot)
    const n = r() < 0.55 ? 1 : 2
    for (let k = 0; k < n; k++) {
      let pick = r() * DEMO_TOTAL_W
      const region = DEMO_REGIONS.find((g) => (pick -= g.w) < 0) ?? DEMO_REGIONS[0]
      // Sebaran mendekati normal (jumlah tiga angka acak)
      const dx = (r() + r() + r() - 1.5) * region.spread
      const dy = (r() + r() + r() - 1.5) * region.spread
      const frp = 3 + r() ** 3 * 160
      const t = slot * SLOT_MS + r() * SLOT_MS
      if (t > now) continue
      out.push([+(region.lat + dy).toFixed(4), +(region.lng + dx).toFixed(4), +frp.toFixed(1), Math.floor(t / 1000)])
    }
  }
  return out
}
