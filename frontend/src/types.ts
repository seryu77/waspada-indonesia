// Kontrak data, sama dengan shared/types.md dan backend/app/models.py

export type HazardType = 'fire' | 'flood' | 'crime' | 'earthquake' | 'landslide' | 'accident' | 'volcano'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type SourceKind = 'official' | 'satellite' | 'cctv' | 'citizen' | 'demo' | 'simulator'
export type Verdict = 'confirmed' | 'false_alarm' | 'uncertain'
export type DispatchState = 'countdown' | 'sent' | 'cancelled' | 'failed'
export type Actor = 'ai' | 'operator' | 'system'
export type LatLng = [number, number]

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
  stream_type: 'hls' | 'rtsp' | 'snapshot'
  last_frame_at?: string
}

export interface Snapshot {
  incidents: Incident[]
  zones: Zone[]
  routes: Route[]
  cameras: Camera[]
  meta?: { verifier: string; dispatch_mode: string; countdown_s: number; server_time: string }
}

export type Connection = 'connecting' | 'live' | 'stale' | 'offline'

export interface LayerVisibility {
  hazards: Record<HazardType, boolean>
  zones: Record<ZoneKind, boolean>
  routes: { blocked: boolean; danger: boolean }
  cameras: boolean
}

export interface ReportInput {
  type: HazardType
  description: string
  lat: number
  lng: number
  photo?: File | null
}
