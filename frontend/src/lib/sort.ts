import type { Incident } from '../types'
import { SEVERITY } from './hazards'

export function effectiveSeverity(i: Incident) {
  return i.verification?.severity ?? i.severity
}

/** Severity tertinggi dulu, lalu yang terbaru. */
export function sortIncidents(list: Incident[]): Incident[] {
  return [...list].sort((a, b) => {
    const d = SEVERITY[effectiveSeverity(b)].rank - SEVERITY[effectiveSeverity(a)].rank
    if (d !== 0) return d
    return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  })
}
