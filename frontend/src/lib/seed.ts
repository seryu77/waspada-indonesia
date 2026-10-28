import raw from '@shared/seed.json'
import type { Camera, Dispatch, Incident, Route, Snapshot, TimelineEntry, Verification, Zone } from '../types'
import { COUNTDOWN_S } from './localEngine'

type RawTimeline = Omit<TimelineEntry, 'at'> & { age_min: number }
type RawIncident = Omit<Incident, 'reported_at' | 'updated_at' | 'status' | 'dispatch' | 'verification'> & {
  age_min: number
  verification?: Omit<Verification, 'verified_at'>
  dispatch?: Omit<Dispatch, 'timeline'> & { timeline: RawTimeline[] }
}

export type SimTemplate = Pick<Incident, 'type' | 'title' | 'description' | 'lat' | 'lng' | 'address' | 'source' | 'magnitude'>

const iso = (now: number, ageMin: number) => new Date(now - ageMin * 60_000).toISOString()

export function seedSnapshot(now = Date.now()): Snapshot {
  const incidents: Incident[] = (raw.incidents as unknown as RawIncident[]).map((r) => {
    const { age_min, dispatch, verification, ...rest } = r
    const reported_at = iso(now, age_min)
    const inc: Incident = {
      ...rest,
      source: { ...rest.source, label: `${rest.source.label} - data demo` },
      status: 'active',
      reported_at,
      updated_at: reported_at,
    }
    if (verification) inc.verification = { ...verification, verified_at: iso(now, Math.max(0, age_min - 1)) }
    if (dispatch) {
      const timeline = dispatch.timeline.map(({ age_min: a, ...t }) => ({ ...t, at: iso(now, a) }))
      if (dispatch.state === 'countdown') {
        // Countdown demo dimulai saat halaman dibuka
        timeline.push(
          { at: iso(now, 0.5), actor: 'ai', action: 'verified', note: 'Terverifikasi AI (confidence 0,90)' },
          { at: new Date(now).toISOString(), actor: 'system', action: 'countdown_started', note: `Hitung mundur ${COUNTDOWN_S} detik dimulai` },
        )
        inc.dispatch = { ...dispatch, timeline, countdown_s: COUNTDOWN_S, deadline: new Date(now + COUNTDOWN_S * 1000).toISOString() }
      } else {
        inc.dispatch = { ...dispatch, timeline, sent_at: timeline.at(-1)?.at }
      }
    }
    return inc
  })
  return {
    incidents,
    zones: raw.zones as unknown as Zone[],
    routes: raw.routes as unknown as Route[],
    cameras: raw.cameras as unknown as Camera[],
  }
}

export const SIM_TEMPLATES = raw.simulator_templates as unknown as SimTemplate[]
