// Mesin lokal untuk mode offline: verifier heuristik "simulasi", simulator, dan dispatch.
// Logikanya mencerminkan backend (app/llm/heuristic.py, app/dispatch/manager.py).
import type { AutomationRules, Dispatch, HazardType, Incident, Severity, SourceKind, Verification } from '../types'
import type { SimTemplate } from './seed'

export const COUNTDOWN_S = 45
/** Confidence minimal untuk auto-dispatch. Di bawahnya operator 112 harus memvalidasi dulu. */
export const DISPATCH_CONFIDENCE_MIN = 0.87

/** Sama dengan default backend (app/config.py Settings.rules) */
export const DEFAULT_RULES: AutomationRules = {
  auto_dispatch_enabled: true,
  auto_dispatch_min: DISPATCH_CONFIDENCE_MIN,
  countdown_s: COUNTDOWN_S,
  false_alarm_hide_min: 0.7,
  citizen_requires_review: true,
  official_quake_auto: true,
}

/** Aturan yang dipakai simulator lokal. Disamakan dengan server setiap meta baru masuk. */
let localRules: AutomationRules = { ...DEFAULT_RULES }
export const getLocalRules = () => localRules
export function setLocalRules(r: AutomationRules) {
  localRules = { ...r }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export const AGENCY: Record<HazardType, string> = {
  fire: 'Damkar + BPBD setempat',
  flood: 'BPBD + Basarnas',
  crime: 'Polres setempat',
  earthquake: 'BPBD + Basarnas',
  landslide: 'BPBD + Dinas PU',
  accident: 'Satlantas + Ambulans 119',
  volcano: 'BPBD + PVMBG',
}

const BASE_CONF: Record<SourceKind, number> = {
  official: 0.95,
  satellite: 0.86,
  cctv: 0.84,
  simulator: 0.8,
  citizen: 0.62,
  demo: 0.55,
}

const ORIGIN_KIND: Record<string, SourceKind> = { firms: 'satellite', bmkg: 'official', magma: 'official', petabencana: 'citizen' }

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export function heuristicVerify(inc: Incident): Verification {
  // Simulator memakai jenis sumber aslinya (cctv, satelit, warga, resmi)
  const origin = inc.source.id.replace(/^sim-/, '')
  const kind = (ORIGIN_KIND[origin] ?? (origin in BASE_CONF ? origin : inc.source.kind)) as SourceKind
  const confidence = Math.min(0.99, Math.max(0.2, BASE_CONF[kind] + rnd(-0.03, 0.08)))
  const verdict = confidence >= 0.7 ? 'confirmed' : confidence >= 0.45 ? 'uncertain' : 'false_alarm'
  const reasoning =
    verdict === 'confirmed'
      ? `Pola deteksi konsisten di beberapa frame dan cocok dengan sumber ${inc.source.label}. Heuristik menilai kejadian nyata.`
      : verdict === 'uncertain'
        ? 'Bukti visual belum cukup jelas. Disarankan cek manual oleh operator sebelum diteruskan.'
        : 'Deteksi tidak konsisten antar frame, kemungkinan pantulan cahaya atau objek mirip.'
  return {
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    severity: inc.severity,
    reasoning,
    recommended_agency: AGENCY[inc.type],
    model: 'heuristik (simulasi)',
    stage: 'triage',
    simulated: true,
    needs_manual_review: verdict !== 'confirmed',
    verified_at: new Date().toISOString(),
  }
}

/** Laporan warga, termasuk laporan warga dari simulator demo. Sama dengan backend is_citizen. */
export const isCitizen = (inc: Pick<Incident, 'source'>) =>
  inc.source.kind === 'citizen' || inc.source.id === 'sim-citizen' || inc.source.id === 'sim-petabencana'

/** Sama dengan backend review_reason: alasan wajib validasi operator, atau null kalau boleh auto-dispatch. */
export function reviewReason(inc: Pick<Incident, 'source'>, v: Verification, rules: AutomationRules = localRules): string | null {
  if (!rules.auto_dispatch_enabled) return 'Auto-dispatch dimatikan operator, menunggu validasi operator 112'
  if (rules.citizen_requires_review && isCitizen(inc)) return 'Laporan warga wajib divalidasi operator 112'
  if (v.verdict !== 'confirmed') return 'Verdict AI belum pasti, menunggu validasi operator 112'
  if (v.confidence < rules.auto_dispatch_min) return `Confidence di bawah ${pct(rules.auto_dispatch_min)}, menunggu validasi operator 112`
  return null
}

/** Sama dengan backend dispatch_route: 'auto' (hitung mundur), 'review' (tunggu operator), atau null. */
export function dispatchRoute(inc: Pick<Incident, 'source'>, v: Verification, rules: AutomationRules = localRules): 'auto' | 'review' | null {
  if (v.severity !== 'high' && v.severity !== 'critical') return null
  if (v.verdict === 'false_alarm') return null
  return reviewReason(inc, v, rules) ? 'review' : 'auto'
}

export function startReview(v: Verification, now = Date.now(), reason?: string): Dispatch {
  const at = new Date(now).toISOString()
  return {
    state: 'review',
    agency: v.recommended_agency,
    mode: 'simulate',
    timeline: [
      { at, actor: 'ai', action: 'verified', note: `Diverifikasi (confidence ${pct(v.confidence)})` },
      { at, actor: 'system', action: 'review_requested', note: reason ?? `Confidence di bawah ${pct(DISPATCH_CONFIDENCE_MIN)}, menunggu validasi operator 112` },
    ],
  }
}

export function routeDispatch(inc: Pick<Incident, 'source'>, v: Verification): Dispatch | undefined {
  const r = dispatchRoute(inc, v)
  if (r === 'auto') return startCountdown(v)
  if (r === 'review') return startReview(v, Date.now(), reviewReason(inc, v) ?? undefined)
  return undefined
}

/** Operator mengirim manual ke 112 (mode offline). */
export function manualDispatch(inc: Incident): Dispatch {
  const at = new Date().toISOString()
  return {
    state: 'sent',
    agency: inc.verification?.recommended_agency ?? AGENCY[inc.type],
    mode: 'simulate',
    sent_at: at,
    timeline: [
      ...(inc.dispatch?.timeline ?? []),
      { at, actor: 'operator', action: 'manual_sent', note: 'Operator mengirim manual ke 112' },
      { at, actor: 'system', action: 'sent', note: 'Terkirim ke command center (simulasi)' },
    ],
  }
}

export function startCountdown(v: Verification, now = Date.now()): Dispatch {
  const at = new Date(now).toISOString()
  const secs = localRules.countdown_s
  return {
    state: 'countdown',
    agency: v.recommended_agency,
    mode: 'simulate',
    countdown_s: secs,
    deadline: new Date(now + secs * 1000).toISOString(),
    timeline: [
      { at, actor: 'ai', action: 'verified', note: `Terverifikasi (confidence ${v.confidence.toFixed(2).replace('.', ',')})` },
      { at, actor: 'system', action: 'countdown_started', note: `Hitung mundur ${secs} detik dimulai` },
    ],
  }
}

export function resolveDispatch(d: Dispatch, how: 'confirmed' | 'cancelled' | 'auto'): Dispatch {
  const at = new Date().toISOString()
  const review = d.state === 'review'
  if (how === 'cancelled') {
    const t = review ? { action: 'rejected', note: 'Ditolak operator setelah dicek' } : { action: 'cancelled', note: 'Dibatalkan operator' }
    return { ...d, state: 'cancelled', deadline: undefined, timeline: [...d.timeline, { at, actor: 'operator', ...t }] }
  }
  const pre =
    how === 'confirmed'
      ? review
        ? { at, actor: 'operator' as const, action: 'validated', note: 'Operator memvalidasi dan mengirim ke 112' }
        : { at, actor: 'operator' as const, action: 'confirmed', note: 'Operator menekan Kirim sekarang' }
      : { at, actor: 'system' as const, action: 'auto_sent', note: 'Tidak ada aksi operator, terkirim otomatis' }
  return {
    ...d,
    state: 'sent',
    sent_at: at,
    deadline: undefined,
    timeline: [...d.timeline, pre, { at, actor: 'system', action: 'sent', note: 'Terkirim ke command center (simulasi)' }],
  }
}

export function simulateIncident(t: SimTemplate, forced?: Severity): Incident {
  const now = new Date().toISOString()
  const severity: Severity = forced ?? pick(['critical', 'critical', 'high', 'high', 'medium', 'low'])
  return {
    ...t,
    id: `sim-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    lat: t.lat + rnd(-0.01, 0.01),
    lng: t.lng + rnd(-0.01, 0.01),
    severity,
    status: 'active',
    source: { id: `sim-${t.source.id}`, label: `${t.source.label} (simulasi)`, kind: 'simulator' },
    reported_at: now,
    updated_at: now,
    verifying: true,
  }
}
