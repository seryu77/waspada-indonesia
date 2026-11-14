// Kontrak data, sama dengan shared/types.md dan backend/app/models.py

export type HazardType = 'fire' | 'flood' | 'crime' | 'earthquake' | 'landslide' | 'accident' | 'volcano'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type SourceKind = 'official' | 'satellite' | 'cctv' | 'citizen' | 'demo' | 'simulator'
export type Verdict = 'confirmed' | 'false_alarm' | 'uncertain'
export type DispatchState = 'review' | 'countdown' | 'sent' | 'cancelled' | 'failed'
export type Actor = 'ai' | 'operator' | 'system'
export type LatLng = [number, number]
/** Alasan kejadian ditutup. expired: sumber tidak lagi melaporkan atau simulasi habis waktunya */
export type Resolution = 'handled' | 'false_alarm' | 'duplicate' | 'expired'

export interface Source {
  id: string
  label: string
  kind: SourceKind
}

export interface Verification {
  verdict: Verdict
  confidence: number
  severity: Severity
  reasoning: string
  recommended_agency: string
  model: string
  stage: 'triage' | 'verify'
  simulated: boolean
  needs_manual_review: boolean
  verified_at?: string
}

export interface TimelineEntry {
  at: string
  actor: Actor
  action: string
  note: string
}

export interface Dispatch {
  state: DispatchState
  agency: string
  mode: 'simulate' | 'webhook'
  deadline?: string
  countdown_s?: number
  sent_at?: string
  timeline: TimelineEntry[]
}

/** note: catatan internal. update: pembaruan untuk publik. question: pertanyaan ke pelapor. reply: balasan pelapor. */
export type NoteKind = 'note' | 'update' | 'question' | 'reply'

export interface OperatorNote {
  at: string
  author: 'operator' | 'pelapor'
  text: string
  kind?: NoteKind
}

/** Laporan yang dikirim dari browser ini, disimpan di localStorage */
export interface MyReport {
  id: string
  token: string
  at: string
}

/** Ringkasan kluster titik panas satelit (NASA FIRMS) */
export interface SatelliteInfo {
  points: number
  /** Lintasan berbeda: pasangan satelit + waktu akuisisi */
  passes: number
  satellites: string[]
  frp_total_mw: number
  high_confidence_points: number
  /** Titik di sel ~500 m yang panas >= 5 hari berbeda dalam 7 hari (kemungkinan flare/industri) */
  persistent_points: number
  persistent_max_days: number
  /** false: riwayat 7 hari tidak tersedia, cek sumber panas tetap dilewati */
  persistent_checked: boolean
  first_seen: string
  last_seen: string
}

export interface Incident {
  id: string
  type: HazardType
  title: string
  description: string
  lat: number
  lng: number
  address: string
  severity: Severity
  status: 'active' | 'resolved'
  source: Source
  reported_at: string
  updated_at: string
  camera_id?: string
  magnitude?: number
  evidence?: string[]
  verifying?: boolean
  verification?: Verification
  dispatch?: Dispatch
  notes?: OperatorNote[]
  resolution?: Resolution
  resolved_at?: string
  resolved_by?: Actor
  satellite?: SatelliteInfo
}

/** Aturan otomasi yang bisa diubah operator (GET/PUT /api/automation) */
export interface AutomationRules {
  auto_dispatch_enabled: boolean
  auto_dispatch_min: number
  countdown_s: number
  false_alarm_hide_min: number
  citizen_requires_review: boolean
  official_quake_auto: boolean
}

export type ZoneKind = 'burn' | 'smoke' | 'flood' | 'volcano_exclusion' | 'crime'

export interface Zone {
  id: string
  kind: ZoneKind
  shape: 'polygon' | 'circle'
  label: string
  source: string
  period?: string
  coords?: LatLng[]
  center?: LatLng
  radius_m?: number
}

export interface Route {
  id: string
  kind: 'blocked' | 'danger'
  label: string
  reason: string
  source: string
  path: LatLng[]
}

export interface Camera {
  id: string
  name: string
  city: string
  lat: number
  lng: number
  status: 'online' | 'offline'
  detections_today: number
  stream_url: string
  /**
   * youtube/embed: siaran publik resmi yang boleh di-embed. portal: link ke portal CCTV resmi
   * (tidak bisa diputar di sini). none: kamera demo tanpa stream.
   */
  stream_type: 'hls' | 'rtsp' | 'snapshot' | 'youtube' | 'embed' | 'portal' | 'none'
  /** Pemilik siaran, ditampilkan sebagai atribusi */
  source?: string
  /** Koordinat tidak ditemukan, titik diletakkan di sekitar pusat wilayah */
  approx_location?: boolean
  last_frame_at?: string
}

/** Titik panas satelit untuk heatmap: [lat, lng, FRP dalam MW, waktu deteksi dalam detik epoch] */
export type Hotspot = [number, number, number, number]

export interface HotspotMeta {
  /** live: data NASA FIRMS. demo: browser membuat data contoh. off: tidak ada data */
  mode: 'live' | 'demo' | 'off'
  satellites: string[]
  count: number
  /** Terakhir server mengecek satelit. Kosong saat mode live = data pertama belum masuk */
  updated_at?: string
  /** Deteksi satelit paling baru */
  latest_at?: string
  error?: string
  /** Naik setiap titik berubah, tanda browser perlu mengambil ulang /api/hotspots */
  version?: number
}

export interface Snapshot {
  incidents: Incident[]
  zones: Zone[]
  routes: Route[]
  cameras: Camera[]
  hotspot_meta?: HotspotMeta
  meta?: SnapshotMeta
}

export interface SnapshotMeta {
  verifier: string
  dispatch_mode: string
  countdown_s: number
  auto_dispatch_min?: number
  rules?: AutomationRules
  /** Mode rekam video demo: simulator acak berhenti, data live dibekukan */
  recording?: boolean
  /** Jenis bahaya yang tampil saat mode rekam (kosong = semua) */
  focus?: HazardType[]
  server_time: string
}

/** polling: hosting tanpa WebSocket, snapshot diambil lewat HTTP berkala */
export type Connection = 'connecting' | 'live' | 'polling' | 'stale' | 'offline'

export interface LayerVisibility {
  hazards: Record<HazardType, boolean>
  zones: Record<ZoneKind, boolean>
  routes: { blocked: boolean; danger: boolean }
  cameras: boolean
  /** Heatmap titik panas (satelit + CCTV + laporan warga) */
  heat: boolean
}

export interface ReportInput {
  type: HazardType
  description: string
  lat: number
  lng: number
  photo?: File | null
}

// Bukti pendukung untuk operator 112 (GET /api/incidents/{id}/evidence)
export interface WeatherNow {
  observed_at: string
  description: string
  weather_code?: number
  temperature_c?: number
  apparent_c?: number
  humidity_pct?: number
  precipitation_mm?: number
  rain_24h_mm?: number
  cloud_cover_pct?: number
  wind_speed_kmh?: number
  wind_gust_kmh?: number
  wind_direction_deg?: number
  is_day: boolean
  elevation_m?: number
}

export interface AirNow {
  observed_at: string
  us_aqi?: number
  pm2_5?: number
  pm10?: number
  carbon_monoxide?: number
}

export interface NearbyItem {
  id: string
  type: HazardType
  title: string
  distance_km: number
  severity: Severity
  source_label: string
  source_kind: SourceKind
  reported_at: string
}

export interface NewsItem {
  title: string
  source: string
  url: string
  published_at: string
}

/** Cek berita (Google News). ok: sudah dicek. outside: lokasi di luar Indonesia. no_place / error: tidak bisa dicek. */
export interface NewsCheck {
  status: 'ok' | 'outside' | 'no_place' | 'error'
  place?: { district?: string; state?: string; country?: string; country_code?: string } | null
  items: NewsItem[]
  total: number
  max_age_days: number
  query?: string
  checked_at: string
  provider: string
}

export interface Evidence {
  incident_id: string
  conditions: { weather: WeatherNow | null; air: AirNow | null; fetched_at: string; provider: string }
  nearby: NearbyItem[]
  nearby_radius_km: number
  camera: (Camera & { distance_km: number; detected_by: boolean }) | null
  frames: string[]
  detection: { source: string; kind: SourceKind; description: string }
  /** Tidak ada (null) untuk simulator, data demo, dan mode offline */
  news?: NewsCheck | null
  /** true kalau dirakit di browser karena server tidak terjangkau */
  local?: boolean
}

export interface Signal {
  label: string
  effect: 'support' | 'against' | 'info'
}
