import type { Incident } from '../types'
import { SEVERITY } from './hazards'

export function effectiveSeverity(i: Incident) {
  return i.verification?.severity ?? i.severity
}

/** Operator: yang menunggu keputusan dispatch (validasi lalu hitung mundur) selalu di atas. */
export function sortForOperator(list: Incident[]): Incident[] {
  const rank = (i: Incident) => (i.dispatch?.state === 'review' ? 2 : i.dispatch?.state === 'countdown' ? 1 : 0)
  return sortIncidents(list).sort((a, b) => rank(b) - rank(a))
}

/** Severity tertinggi dulu, lalu yang terbaru. */
export function sortIncidents(list: Incident[]): Incident[] {
  return [...list].sort((a, b) => {
    const d = SEVERITY[effectiveSeverity(b)].rank - SEVERITY[effectiveSeverity(a)].rank
    if (d !== 0) return d
    return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  })
}
