// Bukti pendukung untuk operator: ambil dari server, atau rakit di browser kalau server mati.
// Indikator otomatis (signals) dihitung di sini dari data mentah, sebagai bantuan baca, bukan keputusan.
import type { AirNow, Evidence, Incident, NearbyItem, NewsCheck, Signal, Snapshot, WeatherNow } from '../types'
import { effectiveSeverity } from './sort'

const NEARBY_KM = 15
const CAMERA_KM = 5

const WMO: Record<number, string> = {
  0: 'cerah', 1: 'cerah berawan', 2: 'berawan', 3: 'mendung', 45: 'kabut', 48: 'kabut', 51: 'gerimis', 53: 'gerimis',
  55: 'gerimis lebat', 61: 'hujan ringan', 63: 'hujan sedang', 65: 'hujan lebat', 80: 'hujan lokal', 81: 'hujan lokal sedang',
  82: 'hujan lokal lebat', 95: 'badai petir', 96: 'badai petir + es', 99: 'badai petir + es',
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dp = toRad(bLat - aLat)
  const dl = toRad(bLng - aLng)
  const h = Math.sin(dp / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

async function localConditions(lat: number, lng: number): Promise<Evidence['conditions']> {
  const q = `latitude=${lat}&longitude=${lng}&timezone=Asia%2FJakarta`
  const cur =
    'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day'
  const [w, a] = await Promise.allSettled([
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=${cur}&hourly=precipitation&past_days=1&forecast_days=1`).then((r) => r.json()),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm2_5,pm10,carbon_monoxide`).then((r) => r.json()),
  ])
  let weather: WeatherNow | null = null
  if (w.status === 'fulfilled' && w.value?.current) {
    const c = w.value.current
    const now = String(c.time).slice(0, 13)
    const hourly: [string, number | null][] = (w.value.hourly?.time ?? []).map((t: string, i: number) => [t, w.value.hourly.precipitation[i]])
    const rain = hourly.filter(([t]) => t.slice(0, 13) <= now).slice(-24).reduce((s, [, p]) => s + (p ?? 0), 0)
    weather = {
      observed_at: c.time,
      description: WMO[c.weather_code] ?? `kode ${c.weather_code}`,
      weather_code: c.weather_code,
      temperature_c: c.temperature_2m,
      apparent_c: c.apparent_temperature,
      humidity_pct: c.relative_humidity_2m,
      precipitation_mm: c.precipitation,
      rain_24h_mm: Math.round(rain * 10) / 10,
      cloud_cover_pct: c.cloud_cover,
      wind_speed_kmh: c.wind_speed_10m,
      wind_gust_kmh: c.wind_gusts_10m,
      wind_direction_deg: c.wind_direction_10m,
      is_day: Boolean(c.is_day),
      elevation_m: w.value.elevation,
    }
  }
  let air: AirNow | null = null
  if (a.status === 'fulfilled' && a.value?.current) {
    const c = a.value.current
    air = { observed_at: c.time, us_aqi: c.us_aqi, pm2_5: c.pm2_5, pm10: c.pm10, carbon_monoxide: c.carbon_monoxide }
  }
  return { weather, air, fetched_at: new Date().toISOString(), provider: 'Open-Meteo' }
}

function localEvidence(inc: Incident, snap: Snapshot, conditions: Evidence['conditions']): Evidence {
  const nearby: NearbyItem[] = snap.incidents
    .filter((o) => o.id !== inc.id && o.status === 'active')
    .map((o) => ({ o, d: haversineKm(inc.lat, inc.lng, o.lat, o.lng) }))
    .filter(({ d }) => d <= NEARBY_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 10)
    .map(({ o, d }) => ({
      id: o.id,
      type: o.type,
      title: o.title,
      distance_km: Math.round(d * 10) / 10,
      severity: effectiveSeverity(o),
      source_label: o.source.label,
      source_kind: o.source.kind,
      reported_at: o.reported_at,
    }))
  let cam = inc.camera_id ? snap.cameras.find((c) => c.id === inc.camera_id) : undefined
  const detected = Boolean(cam)
  if (!cam) {
    const best = [...snap.cameras].sort((a, b) => haversineKm(inc.lat, inc.lng, a.lat, a.lng) - haversineKm(inc.lat, inc.lng, b.lat, b.lng))[0]
    if (best && haversineKm(inc.lat, inc.lng, best.lat, best.lng) <= CAMERA_KM) cam = best
  }
  return {
    incident_id: inc.id,
    conditions,
    nearby,
    nearby_radius_km: NEARBY_KM,
    camera: cam ? { ...cam, distance_km: Math.round(haversineKm(inc.lat, inc.lng, cam.lat, cam.lng) * 10) / 10, detected_by: detected } : null,
    frames: inc.evidence ?? [],
    detection: { source: inc.source.label, kind: inc.source.kind, description: inc.description },
    local: true,
  }
}

export async function fetchEvidence(inc: Incident, snap: Snapshot, offline: boolean): Promise<Evidence> {
  if (!offline) {
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(inc.id)}/evidence`)
      if (res.ok) return (await res.json()) as Evidence
    } catch {
      /* jatuh ke perakitan lokal */
    }
  }
  return localEvidence(inc, snap, await localConditions(inc.lat, inc.lng))
}

const COMPASS = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut']
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

/** Kategori US AQI dalam Bahasa Indonesia. */
export function aqiLevel(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: 'Baik', color: '#3CCF7E' }
  if (aqi <= 100) return { label: 'Sedang', color: '#EAB308' }
  if (aqi <= 150) return { label: 'Tidak sehat (sensitif)', color: '#F97316' }
  if (aqi <= 200) return { label: 'Tidak sehat', color: '#F2555A' }
  if (aqi <= 300) return { label: 'Sangat tidak sehat', color: '#C084FC' }
  return { label: 'Berbahaya', color: '#B42318' }
}

const n1 = (x: number) => x.toFixed(1).replace('.', ',')

/** Indikator otomatis: kondisi yang mendukung atau melemahkan dugaan kejadian. */
export function signals(inc: Incident, ev: Evidence): Signal[] {
  const out: Signal[] = []
  const w = ev.conditions.weather
  const a = ev.conditions.air
  const add = (cond: unknown, label: string, effect: Signal['effect']) => {
    if (cond) out.push({ label, effect })
  }

  add(inc.source.kind === 'official', 'Data dari sumber resmi', 'support')
  add(ev.camera?.detected_by, `Terdeteksi langsung oleh CCTV ${ev.camera?.name}`, 'support')
  add(ev.frames.length > 0, `${ev.frames.length} frame bukti tersimpan (wajah dan plat diblur)`, 'support')
  const others = ev.nearby.length
  add(others > 0, `${others} kejadian atau laporan lain dalam ${ev.nearby_radius_km} km`, 'support')
  add(others === 0 && inc.source.kind !== 'official', `Tidak ada laporan lain dalam ${ev.nearby_radius_km} km`, 'against')

  if (w) {
    const hum = w.humidity_pct ?? 100
    const wind = w.wind_speed_kmh ?? 0
    const gust = w.wind_gust_kmh ?? 0
    const rainNow = w.precipitation_mm ?? 0
    const rain24 = w.rain_24h_mm ?? 0
    const elev = w.elevation_m ?? 0
    const fog = w.weather_code === 45 || w.weather_code === 48
    switch (inc.type) {
      case 'fire':
        add(hum <= 50, `Udara kering, kelembapan ${hum}%`, 'support')
        add(hum >= 85, `Udara lembap, kelembapan ${hum}%`, 'against')
        add(wind >= 20, `Angin ${n1(wind)} km/j dapat mempercepat sebaran api`, 'support')
        add(rainNow >= 1, `Sedang hujan ${n1(rainNow)} mm`, 'against')
        add(rain24 >= 20, `Hujan ${rain24 >= 50 ? 'deras ' : ''}24 jam terakhir, ${n1(rain24)} mm`, 'against')
        add(ev.nearby.some((x) => x.type === 'fire' && x.source_kind === 'satellite'), 'Ada indikasi kebakaran dari satelit di sekitar', 'support')
        break
      case 'flood':
        add(rain24 >= 50, `Hujan lebat 24 jam terakhir, ${n1(rain24)} mm`, 'support')
        add(rain24 >= 20 && rain24 < 50, `Hujan 24 jam terakhir ${n1(rain24)} mm`, 'info')
        add(rain24 < 5, `Hampir tidak hujan 24 jam terakhir (${n1(rain24)} mm)`, 'against')
        add(elev <= 10, `Dataran rendah, ketinggian ${Math.round(elev)} m`, 'support')
        break
      case 'landslide':
        add(rain24 >= 50, `Hujan lebat 24 jam terakhir, ${n1(rain24)} mm`, 'support')
        add(rain24 < 5, `Hampir tidak hujan 24 jam terakhir (${n1(rain24)} mm)`, 'against')
        add(elev >= 200, `Daerah perbukitan, ketinggian ${Math.round(elev)} m`, 'support')
        add(elev < 30, `Dataran rendah (${Math.round(elev)} m), longsor kurang mungkin`, 'against')
        break
      case 'accident':
        add(rainNow >= 0.5, `Jalan basah, hujan ${n1(rainNow)} mm`, 'support')
        add(fog, 'Kabut, jarak pandang terbatas', 'support')
        add(!w.is_day, 'Malam hari, jarak pandang terbatas', 'info')
        break
      case 'crime':
        add(!w.is_day, 'Terjadi di malam hari', 'info')
        break
    }
    add(gust >= 50, `Angin kencang, hembusan ${Math.round(gust)} km/j`, inc.type === 'fire' || inc.type === 'accident' ? 'support' : 'info')
  }
  if (inc.satellite) satelliteSignals(inc, ev, add)
  const news = ev.news
  if (news?.status === 'ok') {
    const where = newsPlace(news)
    add(news.total > 0, `${news.total} berita ${news.max_age_days} hari terakhir tentang kejadian serupa di ${where}`, 'support')
    // Tidak ada berita bukan bukti false alarm: kejadian kecil atau baru sering belum diberitakan
    add(news.total === 0, `Belum ada berita ${news.max_age_days} hari terakhir di ${where}`, 'info')
  }
  add(news?.status === 'outside', `Lokasi di luar Indonesia (${news?.place?.country ?? 'negara lain'})`, 'info')
  if (a?.us_aqi !== undefined) {
    const smoky = inc.type === 'fire' || inc.type === 'accident' || inc.type === 'volcano'
    add(a.us_aqi > 150, `Kualitas udara ${aqiLevel(a.us_aqi).label.toLowerCase()} (AQI ${a.us_aqi}), indikasi asap atau abu`, smoky ? 'support' : 'info')
    add(inc.type === 'fire' && a.us_aqi <= 50, `Udara bersih (AQI ${a.us_aqi}), tidak ada indikasi asap`, 'against')
  }
  return out
}

export const newsPlace = (n: NewsCheck) => [n.place?.district, n.place?.state].filter(Boolean).join(', ') || 'wilayah ini'

/** Sama dengan ambang verifier satelit di backend (app/llm/heuristic.py) */
const PM25_SMOKE = 35.5
const CO_SMOKE = 800

/** Faktor data satelit: konsistensi antar lintasan, sumber panas tetap, dan bukti di luar satelit. */
function satelliteSignals(inc: Incident, ev: Evidence, add: (cond: unknown, label: string, effect: Signal['effect']) => void) {
  const s = inc.satellite
  if (!s) return
  add(s.passes >= 3, `Terlihat di ${s.passes} lintasan satelit`, 'support')
  add(s.passes < 3, `Terlihat di ${s.passes} lintasan satelit (batas minimal)`, 'info')
  add(s.satellites.length >= 2, `${s.satellites.length} satelit berbeda: ${s.satellites.join(', ')}`, 'support')
  const share = s.points ? s.high_confidence_points / s.points : 0
  add(share >= 0.5, `${s.high_confidence_points} dari ${s.points} deteksi berkeyakinan tinggi`, 'support')
  add(s.high_confidence_points === 0, 'Tidak ada deteksi berkeyakinan tinggi', 'against')
  add(s.frp_total_mw >= 100, `Total FRP ${Math.round(s.frp_total_mw)} MW`, 'support')
  add(
    s.persistent_points > 0,
    `${s.persistent_points} deteksi di lokasi yang panas ${s.persistent_max_days} hari dalam 7 hari terakhir, kemungkinan flare gas atau industri`,
    'against',
  )
  add(!s.persistent_checked, 'Riwayat 7 hari tidak tersedia, cek sumber panas tetap dilewati', 'info')
  const pm = ev.conditions.air?.pm2_5
  const co = ev.conditions.air?.carbon_monoxide
  const smoke = (pm ?? 0) >= PM25_SMOKE || (co ?? 0) >= CO_SMOKE
  add(pm !== undefined && pm !== null && pm >= PM25_SMOKE, `PM2.5 ${n1(pm ?? 0)} ug/m3, indikasi asap`, 'support')
  add(co !== undefined && co !== null && co >= CO_SMOKE, `CO ${Math.round(co ?? 0)} ug/m3, indikasi asap`, 'support')
  const ground = ev.nearby.filter((x) => x.type === 'fire' && x.source_kind !== 'satellite').length
  add(ground > 0, `${ground} laporan kebakaran dari sumber lain dalam ${ev.nearby_radius_km} km`, 'support')
  const reported = ev.news?.status === 'ok' && ev.news.total > 0
  add(!smoke && ground === 0 && !reported, 'Belum ada bukti di luar satelit (asap, laporan, atau berita)', 'against')
}
