// Status laporan dari sudut pandang warga pelapor, dalam bahasa sehari-hari.
import type { Incident, OperatorNote } from '../types'

export interface CitizenStep {
  label: string
  at?: string
  done: boolean
  /** Langkah terakhir yang sudah tercapai */
  current: boolean
  note?: string
}

const firstOperatorAction = (i: Incident) =>
  i.dispatch?.timeline.find((t) => t.actor === 'operator')?.at ?? i.notes?.find((n) => n.author === 'operator' && n.kind !== 'note')?.at

/** Lima tahap: diterima, dicek AI, ditinjau operator, petugas dikirim, selesai */
export function citizenSteps(i: Incident): CitizenStep[] {
  const reviewedAt = i.dispatch?.timeline.find((t) => t.action === 'review_requested' || t.action === 'countdown_started')?.at ?? firstOperatorAction(i)
  const sentAt = i.dispatch?.state === 'sent' ? i.dispatch.sent_at : undefined
  const rejected = i.dispatch?.state === 'cancelled'
  const closed = i.status === 'resolved'

  const closedNote =
    i.resolution === 'false_alarm'
      ? 'Setelah dicek, tidak ditemukan kejadian di lokasi.'
      : i.resolution === 'duplicate'
        ? 'Kejadian ini sudah dilaporkan sebelumnya dan sedang ditangani.'
        : i.resolution === 'expired'
          ? 'Laporan ditutup otomatis karena tidak ada perkembangan.'
          : 'Kejadian sudah ditangani petugas.'

  const steps: Omit<CitizenStep, 'current'>[] = [
    { label: 'Laporan diterima', at: i.reported_at, done: true },
    {
      label: 'Dicek sistem',
      at: i.verification?.verified_at,
      done: !!i.verification,
      note: i.verifying ? 'Sedang dicek otomatis, biasanya beberapa detik.' : undefined,
    },
    {
      label: 'Ditinjau operator 112',
      at: reviewedAt,
      done: !!reviewedAt || closed,
      note: rejected && !closed ? 'Operator memutuskan belum perlu mengirim petugas. Laporan tetap dipantau.' : undefined,
    },
    { label: 'Petugas diberitahu', at: sentAt, done: !!sentAt, note: sentAt ? `Diteruskan ke ${i.dispatch?.agency}.` : undefined },
    { label: 'Selesai', at: i.resolved_at, done: closed, note: closed ? closedNote : undefined },
  ]
  const last = steps.reduce((acc, s, idx) => (s.done ? idx : acc), 0)
  return steps.map((s, idx) => ({ ...s, current: idx === last }))
}

/** Label status singkat untuk daftar */
export function citizenStatus(i: Incident): { label: string; color: string } {
  if (i.status === 'resolved') return { label: i.resolution === 'false_alarm' ? 'Tidak ditemukan' : 'Selesai', color: '#929AA4' }
  if (i.dispatch?.state === 'sent') return { label: 'Petugas diberitahu', color: '#3CCF7E' }
  if (hasOpenQuestion(i)) return { label: 'Operator bertanya', color: '#38BDF8' }
  if (i.verifying) return { label: 'Dicek sistem', color: '#EAB308' }
  // Selain itu: ikuti tahap terakhir yang sudah tercapai
  const current = citizenSteps(i).find((s) => s.current)
  if (current?.label === 'Ditinjau operator 112') return { label: 'Ditinjau operator', color: '#EAB308' }
  return { label: 'Dipantau', color: '#C3C8CF' }
}

/** Pesan yang terlihat oleh pelapor: pembaruan, pertanyaan operator, dan balasan sendiri */
export const thread = (i: Incident): OperatorNote[] => (i.notes ?? []).filter((n) => n.kind && n.kind !== 'note')

/** Pertanyaan operator terakhir belum dijawab pelapor */
export function hasOpenQuestion(i: Incident): boolean {
  const t = thread(i)
  const lastQ = t.map((n) => n.kind).lastIndexOf('question')
  return lastQ !== -1 && !t.slice(lastQ + 1).some((n) => n.kind === 'reply')
}

/** Penanda perubahan yang perlu diketahui pelapor: tahap status + pesan dari operator */
export function citizenSignature(i: Incident): string {
  const stage = citizenSteps(i).findIndex((s) => s.current)
  const fromOperator = thread(i).filter((n) => n.author === 'operator').length
  return `${stage}:${fromOperator}:${i.status}`
}

const SEEN_KEY = 'waspada.myReports.seen'
export function loadSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
export function saveSeen(seen: Record<string, string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
}
