import { Activity, CarFront, Flame, Mountain, MountainSnow, ShieldAlert, Waves, type LucideIcon } from 'lucide-react'
import type { HazardType, Severity, SourceKind, ZoneKind } from '../types'

export interface HazardMeta {
  label: string
  color: string
  Icon: LucideIcon
}

export const HAZARDS: Record<HazardType, HazardMeta> = {
  fire: { label: 'Kebakaran / Karhutla', color: '#FB923C', Icon: Flame },
  flood: { label: 'Banjir', color: '#38BDF8', Icon: Waves },
  crime: { label: 'Kriminal', color: '#C084FC', Icon: ShieldAlert },
  earthquake: { label: 'Gempa', color: '#FBBF24', Icon: Activity },
  landslide: { label: 'Longsor', color: '#D4A373', Icon: Mountain },
  accident: { label: 'Kecelakaan', color: '#2DD4BF', Icon: CarFront },
  volcano: { label: 'Gunung api', color: '#F87171', Icon: MountainSnow },
}

export const HAZARD_ORDER: HazardType[] = ['fire', 'flood', 'earthquake', 'landslide', 'accident', 'volcano', 'crime']

export const SEVERITY: Record<Severity, { label: string; color: string; rank: number }> = {
  critical: { label: 'Kritis', color: '#EF4444', rank: 4 },
  high: { label: 'Tinggi', color: '#F97316', rank: 3 },
  medium: { label: 'Sedang', color: '#EAB308', rank: 2 },
  low: { label: 'Rendah', color: '#94A3B8', rank: 1 },
}

export const ZONES: Record<ZoneKind, { label: string; stroke: string; fill: string; fillOpacity: number; dash?: string }> = {
  burn: { label: 'Zona terbakar', stroke: '#F97316', fill: '#F97316', fillOpacity: 0.35 },
  smoke: { label: 'Sebaran asap', stroke: '#94A3B8', fill: '#CBD5E1', fillOpacity: 0.16, dash: '4 6' },
  flood: { label: 'Zona genangan', stroke: '#38BDF8', fill: '#38BDF8', fillOpacity: 0.25 },
  volcano_exclusion: { label: 'Radius larangan gunung api', stroke: '#F87171', fill: '#F87171', fillOpacity: 0.14, dash: '8 6' },
  crime: { label: 'Area rawan kriminal', stroke: '#C084FC', fill: '#C084FC', fillOpacity: 0.18, dash: '2 5' },
}

export const ZONE_ORDER: ZoneKind[] = ['burn', 'smoke', 'flood', 'volcano_exclusion', 'crime']

export const ROUTES = {
  blocked: { label: 'Rute terhalang', color: '#FACC15', dash: '10 8' },
  danger: { label: 'Rute dalam bahaya', color: '#EF4444', dash: undefined },
} as const

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  official: 'Sumber resmi',
  satellite: 'Satelit',
  cctv: 'CCTV + AI',
  citizen: 'Laporan warga',
  demo: 'Data demo',
  simulator: 'Simulator demo',
}
