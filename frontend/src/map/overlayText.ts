import type { Route, Zone } from '../types'
import { ROUTES, ZONES } from '../lib/hazards'

export function zoneText(z: Zone): string {
  const kind = ZONES[z.kind].label
  return `${kind}: ${z.label}. Sumber: ${z.source}${z.period ? `, periode ${z.period}` : ''}`
}

export function routeText(r: Route): string {
  return `${ROUTES[r.kind].label}: ${r.label}. ${r.reason} Sumber: ${r.source}`
}
