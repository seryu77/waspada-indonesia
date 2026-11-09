// Logika dashboard operator: pembagian antrean, penjelasan kenapa kejadian terindikasi, dan log aktivitas.
import type { Actor, AutomationRules, Incident, Resolution } from '../types'
import { HAZARDS, SEVERITY, SOURCE_KIND_LABEL } from './hazards'
import { effectiveSeverity, sortIncidents } from './sort'
import { dispatchRoute, isCitizen, reviewReason } from './localEngine'
import { pct } from './format'

export const isPending = (i: Incident) => i.dispatch?.state === 'review' || i.dispatch?.state === 'countdown'

// ---- Antrean ----

export type QueueTab = 'review' | 'countdown' | 'citizen' | 'active' | 'history'

export const QUEUE_TABS: { id: QueueTab; label: string; hint: string }[] = [
  { id: 'review', label: 'Validasi', hint: 'Menunggu keputusan operator, tidak akan terkirim sendiri' },
  { id: 'countdown', label: 'Hitung mundur', hint: 'Auto-dispatch berjalan, operator bisa kirim sekarang atau batalkan' },
  { id: 'citizen', label: 'Laporan warga', hint: 'Laporan dari aplikasi Waspada dan PetaBencana' },
  { id: 'active', label: 'Semua aktif', hint: 'Semua kejadian yang masih aktif' },
  { id: 'history', label: 'Riwayat', hint: 'Sudah diputuskan atau ditutup' },
]

export function inTab(i: Incident, tab: QueueTab): boolean {
  const active = i.status === 'active'
  switch (tab) {
    case 'review':
      return active && i.dispatch?.state === 'review'
    case 'countdown':
      return active && i.dispatch?.state === 'countdown'
    case 'citizen':
      return active && isCitizen(i)
    case 'active':
      return active
    case 'history':
      return !active || (!!i.dispatch && !isPending(i))
  }
}

export function sortForTab(list: Incident[], tab: QueueTab): Incident[] {
  if (tab === 'history') return [...list].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
  // Validasi: yang paling lama menunggu di atas (FIFO), lalu severity
  if (tab === 'review') return sortIncidents(list).sort((a, b) => waitingSince(a).localeCompare(waitingSince(b)))
  if (tab === 'countdown') return [...list].sort((a, b) => (a.dispatch?.deadline ?? '').localeCompare(b.dispatch?.deadline ?? ''))
  const rank = (i: Incident) => (awaitingOperator(i) ? 3 : i.dispatch?.state === 'review' ? 2 : i.dispatch?.state === 'countdown' ? 1 : 0)
  return sortIncidents(list).sort((a, b) => rank(b) - rank(a))
}

/** Sejak kapan kejadian menunggu keputusan operator */
export function waitingSince(i: Incident): string {
  const t = i.dispatch?.timeline.find((e) => e.action === 'review_requested' || e.action === 'countdown_started')
  return t?.at ?? i.verification?.verified_at ?? i.reported_at
}

export function lastActivity(i: Incident): string {
  const ts = [i.updated_at, i.resolved_at, i.dispatch?.timeline.at(-1)?.at, i.notes?.at(-1)?.at].filter(Boolean) as string[]
  return ts.sort().at(-1) ?? i.reported_at
}

export function matchesQuery(i: Incident, q: string): boolean {
  if (!q) return true
  const hay = `${i.title} ${i.address} ${i.description} ${i.id} ${i.source.label} ${HAZARDS[i.type].label}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w))
}

/** Balasan terakhir di percakapan datang dari pelapor, belum ditanggapi operator */
export function awaitingOperator(i: Incident): boolean {
  const last = (i.notes ?? []).filter((n) => n.kind && n.kind !== 'note').at(-1)
  return i.status === 'active' && last?.author === 'pelapor'
}

// ---- Status ----

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  handled: 'Sudah ditangani',
  false_alarm: 'False alarm',
  duplicate: 'Duplikat',
  expired: 'Kedaluwarsa',
}

export const ACTOR_LABEL: Record<Actor, string> = { ai: 'AI', operator: 'Operator', system: 'Sistem' }

export type StatusTone = 'critical' | 'warn' | 'ok' | 'muted' | 'info'
export const TONE_COLOR: Record<StatusTone, string> = {
  critical: '#F2555A',
  warn: '#EAB308',
  ok: '#3CCF7E',
  muted: '#929AA4',
  info: '#C3C8CF',
}

/** Status kerja satu kejadian, untuk chip di antrean dan judul ruang kerja */
export function workStatus(i: Incident): { label: string; tone: StatusTone } {
  if (i.status === 'resolved') return { label: i.resolution ? RESOLUTION_LABEL[i.resolution] : 'Selesai', tone: 'muted' }
  if (i.verifying) return { label: 'Diverifikasi AI', tone: 'warn' }
  switch (i.dispatch?.state) {
    case 'review':
      return { label: 'Butuh validasi', tone: 'warn' }
    case 'countdown':
      return { label: 'Hitung mundur', tone: 'critical' }
    case 'sent':
      return { label: 'Terkirim 112', tone: 'ok' }
    case 'failed':
      return { label: 'Gagal kirim', tone: 'critical' }
    case 'cancelled':
      return { label: i.dispatch.timeline.some((t) => t.action === 'rejected') ? 'Ditolak' : 'Dibatalkan', tone: 'muted' }
  }
  return { label: 'Dipantau', tone: 'info' }
}

// ---- Kenapa terindikasi ----

export interface IndicationStep {
  key: 'detect' | 'verify' | 'route'
  title: string
  at?: string
  headline: string
  detail?: string
  tone: StatusTone
}

function detectHeadline(i: Incident): string {
  const origin = i.source.id.replace(/^sim-/, '')
  if (i.source.kind === 'cctv' || origin === 'cctv') return 'Terdeteksi computer vision dari CCTV'
  if (isCitizen(i)) return 'Laporan warga masuk'
  if (i.source.kind === 'satellite' || origin === 'firms') return 'Titik panas terdeteksi satelit'
  if (i.source.kind === 'official' || origin === 'bmkg' || origin === 'magma') return 'Data dari sumber resmi'
  return SOURCE_KIND_LABEL[i.source.kind]
}

/**
 * Rantai alasan sebuah kejadian muncul dan masuk antrean: sumber deteksi, penilaian AI,
 * lalu aturan otomasi yang memutuskan jalurnya. Bantuan baca untuk operator.
 */
export function explainIndication(i: Incident, rules: AutomationRules): IndicationStep[] {
  const steps: IndicationStep[] = []
  const sev = effectiveSeverity(i)

  steps.push({
    key: 'detect',
    title: 'Deteksi',
    at: i.reported_at,
    headline: `${detectHeadline(i)}: ${HAZARDS[i.type].label.toLowerCase()}`,
    detail: `${i.source.label}. ${i.description}${i.magnitude !== undefined ? ` Magnitudo M${i.magnitude.toFixed(1).replace('.', ',')}.` : ''}`,
    tone: 'info',
  })

  const v = i.verification
  if (i.verifying) {
    steps.push({ key: 'verify', title: 'Verifikasi AI', headline: 'Sedang diverifikasi, tahap 1 filter cepat', tone: 'warn' })
  } else if (v) {
    const verdict = v.verdict === 'confirmed' ? 'Terkonfirmasi' : v.verdict === 'false_alarm' ? 'False alarm' : 'Belum pasti'
    steps.push({
      key: 'verify',
      title: 'Verifikasi AI',
      at: v.verified_at,
      headline: `${verdict}, kepastian ${pct(v.confidence)}, severity ${SEVERITY[v.severity].label.toLowerCase()}`,
      detail: v.reasoning,
      tone: v.verdict === 'confirmed' ? 'ok' : v.verdict === 'false_alarm' ? 'muted' : 'warn',
    })
  } else {
    steps.push({ key: 'verify', title: 'Verifikasi AI', headline: 'Tidak melalui AI, data dari sumber resmi', tone: 'muted' })
  }

  steps.push({ key: 'route', title: 'Aturan otomasi', ...routeExplanation(i, rules, sev) })
  return steps
}

function routeExplanation(i: Incident, rules: AutomationRules, sev: Incident['severity']): Omit<IndicationStep, 'key' | 'title'> {
  const v = i.verification
  if (i.status === 'resolved') {
    const by = i.resolved_by ? ACTOR_LABEL[i.resolved_by].toLowerCase() : 'sistem'
    const why =
      i.resolution === 'false_alarm' && i.resolved_by === 'ai'
        ? `False alarm dengan kepastian ${pct(v?.confidence ?? 0)}, di atas ambang ${pct(rules.false_alarm_hide_min)}. Disembunyikan dari peta, tetap tercatat.`
        : i.resolution === 'expired'
          ? 'Sumber tidak lagi melaporkan kejadian ini, atau kejadian simulasi habis waktunya.'
          : undefined
    return { at: i.resolved_at, headline: `Ditutup ${by}: ${i.resolution ? RESOLUTION_LABEL[i.resolution].toLowerCase() : 'selesai'}`, detail: why, tone: 'muted' }
  }
  const d = i.dispatch
  if (d) {
    const first = d.timeline.find((t) => t.action === 'review_requested' || t.action === 'countdown_started' || t.action === 'manual_sent')
    if (first?.action === 'manual_sent') return { at: first.at, headline: 'Dikirim manual oleh operator', tone: 'ok' }
    if (first?.action === 'review_requested') return { at: first.at, headline: 'Masuk antrean validasi', detail: first.note, tone: 'warn' }
    return {
      at: first?.at,
      headline: 'Masuk auto-dispatch (hitung mundur)',
      detail: v
        ? `Terkonfirmasi dengan kepastian ${pct(v.confidence)}, di atas ambang ${pct(rules.auto_dispatch_min)}, severity ${SEVERITY[sev].label.toLowerCase()}.`
        : 'Data resmi memenuhi aturan kirim langsung.',
      tone: 'critical',
    }
  }
  if (!v) return { headline: 'Tidak masuk alur dispatch otomatis', detail: 'Data resmi di bawah ambang kirim langsung. Pantau, atau kirim manual bila perlu.', tone: 'info' }
  if (sev !== 'high' && sev !== 'critical')
    return {
      headline: 'Dipantau, tidak masuk alur dispatch',
      detail: `Severity ${SEVERITY[sev].label.toLowerCase()}. Hanya severity tinggi dan kritis yang masuk dispatch otomatis. Operator tetap bisa kirim manual.`,
      tone: 'info',
    }
  if (v.verdict === 'false_alarm') return { headline: 'Dinilai false alarm oleh AI', detail: `Kepastian ${pct(v.confidence)}, di bawah ambang sembunyi otomatis ${pct(rules.false_alarm_hide_min)}. Cek manual.`, tone: 'muted' }
  return { headline: 'Belum masuk alur dispatch', detail: reviewReason(i, v, rules) ?? undefined, tone: 'info' }
}

/** Dampak aturan baru pada kejadian aktif yang sudah terverifikasi: berapa yang akan auto, berapa yang validasi */
export function rulesImpact(incidents: Incident[], rules: AutomationRules) {
  let auto = 0
  let review = 0
  let none = 0
  for (const i of incidents) {
    if (i.status !== 'active' || !i.verification) continue
    const r = dispatchRoute(i, i.verification, rules)
    if (r === 'auto') auto++
    else if (r === 'review') review++
    else none++
  }
  return { auto, review, none }
}

// ---- Log aktivitas ----

export type ActivityActor = Actor | 'source' | 'citizen'
export interface ActivityEvent {
  id: string
  at: string
  actor: ActivityActor
  incidentId?: string
  incidentTitle?: string
  text: string
  tone: StatusTone
}

export const ACTIVITY_ACTOR_LABEL: Record<ActivityActor, string> = { source: 'Deteksi', ai: 'AI', operator: 'Operator', system: 'Sistem', citizen: 'Pelapor' }

const ACTION_TONE: Record<string, StatusTone> = {
  countdown_started: 'critical',
  review_requested: 'warn',
  sent: 'ok',
  failed: 'critical',
  rejected: 'muted',
  cancelled: 'muted',
}

/** Rakit log dari state kejadian (bekerja juga di mode offline), ditambah event lokal seperti perubahan aturan. */
export function buildActivity(incidents: Incident[], extra: ActivityEvent[] = [], limit = 300): ActivityEvent[] {
  const out: ActivityEvent[] = [...extra]
  for (const i of incidents) {
    const base = { incidentId: i.id, incidentTitle: i.title }
    out.push({
      ...base,
      id: `${i.id}:reported`,
      at: i.reported_at,
      actor: 'source',
      text: `${detectHeadline(i)} (${HAZARDS[i.type].label.toLowerCase()}, ${SEVERITY[i.severity].label.toLowerCase()}) di ${i.address}`,
      tone: i.severity === 'critical' ? 'critical' : 'info',
    })
    const v = i.verification
    if (v?.verified_at) {
      out.push({
        ...base,
        id: `${i.id}:verified`,
        at: v.verified_at,
        actor: 'ai',
        text: `${v.verdict === 'confirmed' ? 'Terkonfirmasi' : v.verdict === 'false_alarm' ? 'False alarm' : 'Belum pasti'}, kepastian ${pct(v.confidence)} (${v.model})`,
        tone: v.verdict === 'confirmed' ? 'ok' : v.verdict === 'false_alarm' ? 'muted' : 'warn',
      })
    }
    i.dispatch?.timeline.forEach((t, idx) => {
      if (t.action === 'verified') return // sudah tercatat dari hasil verifikasi
      out.push({ ...base, id: `${i.id}:d${idx}`, at: t.at, actor: t.actor, text: t.note, tone: ACTION_TONE[t.action] ?? (t.actor === 'operator' ? 'ok' : 'info') })
    })
    i.notes?.forEach((n, idx) => {
      const fromReporter = n.author === 'pelapor'
      const prefix = fromReporter ? 'Pelapor membalas' : n.kind === 'update' ? 'Pembaruan publik' : n.kind === 'question' ? 'Bertanya ke pelapor' : 'Catatan'
      out.push({ ...base, id: `${i.id}:n${idx}`, at: n.at, actor: fromReporter ? 'citizen' : 'operator', text: `${prefix}: ${n.text}`, tone: fromReporter ? 'warn' : 'info' })
    })
    if (i.status === 'resolved' && i.resolved_at) {
      out.push({
        ...base,
        id: `${i.id}:resolved`,
        at: i.resolved_at,
        actor: i.resolved_by ?? 'system',
        text: `Ditutup: ${i.resolution ? RESOLUTION_LABEL[i.resolution].toLowerCase() : 'selesai'}`,
        tone: 'muted',
      })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

export function activityCsv(events: ActivityEvent[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = events.map((e) => [e.at, ACTIVITY_ACTOR_LABEL[e.actor], e.incidentId ?? '', e.incidentTitle ?? '', e.text].map(esc).join(','))
  return ['waktu,pelaku,id_kejadian,kejadian,aktivitas', ...rows].join('\n')
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ---- KPI ----

const DAY = 24 * 3600_000

/** Median waktu dari kejadian masuk antrean sampai operator memutuskan, dalam detik */
export function medianDecisionSeconds(incidents: Incident[]): number | null {
  const ds: number[] = []
  for (const i of incidents) {
    const tl = i.dispatch?.timeline
    if (!tl) continue
    const start = tl.find((t) => t.action === 'review_requested' || t.action === 'countdown_started')
    const decided = tl.find((t) => t.actor === 'operator')
    if (start && decided) ds.push((Date.parse(decided.at) - Date.parse(start.at)) / 1000)
  }
  if (ds.length === 0) return null
  ds.sort((a, b) => a - b)
  return ds[Math.floor(ds.length / 2)]
}

export function kpis(incidents: Incident[], now = Date.now()) {
  const active = incidents.filter((i) => i.status === 'active')
  const recent = (iso?: string) => !!iso && now - Date.parse(iso) <= DAY
  return {
    review: active.filter((i) => i.dispatch?.state === 'review').length,
    countdown: active.filter((i) => i.dispatch?.state === 'countdown').length,
    citizen: active.filter(isCitizen).length,
    awaitingReply: active.filter(awaitingOperator).length,
    sent: incidents.filter((i) => i.dispatch?.state === 'sent' && recent(i.dispatch.sent_at)).length,
    rejected: incidents.filter(
      (i) => (i.dispatch?.state === 'cancelled' && recent(i.updated_at)) || (i.resolution === 'false_alarm' && recent(i.resolved_at)),
    ).length,
    medianDecision: medianDecisionSeconds(incidents),
  }
}

export function fmtDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} dtk`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} mnt ${Math.round(s % 60)} dtk`
  return `${Math.floor(m / 60)} jam ${m % 60} mnt`
}
