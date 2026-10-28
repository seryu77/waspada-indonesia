import type { ReactNode } from 'react'
import { ArrowLeft, Bot, Cctv, Clock, LocateFixed, MapPin, Radio, TriangleAlert } from 'lucide-react'
import type { Camera, Incident } from '../types'
import { HAZARDS, SOURCE_KIND_LABEL } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { coord, dateTimeWIB, pct, timeAgo } from '../lib/format'
import { HazardBadge, ModelTag, SeverityChip, VerifyBadge } from './bits'
import { DispatchTimeline } from './DispatchTimeline'

interface Props {
  incident: Incident
  camera?: Camera
  onBack: () => void
  onFocus: () => void
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
}

const VERDICT_LABEL = { confirmed: 'Terkonfirmasi', false_alarm: 'False alarm', uncertain: 'Belum pasti' } as const

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 py-1.5">
      <Icon size={15} className="mt-0.5 shrink-0 text-muted-fg" aria-hidden />
      <div className="min-w-0 text-sm">
        <div className="text-[11px] text-muted-fg">{label}</div>
        <div className="text-fg">{children}</div>
      </div>
    </div>
  )
}

export function IncidentDetail({ incident: i, camera, onBack, onFocus, onConfirm, onCancel }: Props) {
  const v = i.verification
  const sev = effectiveSeverity(i)
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-fg transition-colors duration-150 hover:bg-white/10 hover:text-fg"
        >
          <ArrowLeft size={16} aria-hidden /> Semua kejadian
        </button>
        <button
          type="button"
          onClick={onFocus}
          aria-label="Pusatkan peta ke lokasi kejadian"
          className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-muted-fg transition-colors duration-150 hover:bg-white/10 hover:text-fg"
        >
          <LocateFixed size={16} aria-hidden />
        </button>
      </div>

      <div className="flex items-start gap-3">
        <HazardBadge type={i.type} size={40} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={sev} />
            <span className="text-xs text-muted-fg">{HAZARDS[i.type].label}</span>
          </div>
          <h2 className="mt-1 text-base font-semibold leading-snug">{i.title}</h2>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-[#CBD5E1]">{i.description}</p>

      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-card/70 px-3 py-1">
        <Row icon={MapPin} label="Lokasi">
          {i.address}
          <span className="block font-mono text-[11px] text-muted-fg tabular">{coord(i.lat, i.lng)}</span>
        </Row>
        <Row icon={Radio} label="Sumber data">
          {i.source.label}
          <span className="block text-[11px] text-muted-fg">{SOURCE_KIND_LABEL[i.source.kind]}</span>
        </Row>
        <Row icon={Clock} label="Waktu laporan">
          {dateTimeWIB(i.reported_at)} <span className="text-muted-fg">({timeAgo(i.reported_at)})</span>
        </Row>
        {i.magnitude !== undefined && (
          <Row icon={TriangleAlert} label="Magnitudo">
            M {i.magnitude.toFixed(1).replace('.', ',')}
          </Row>
        )}
        {camera && (
          <Row icon={Cctv} label="Kamera">
            {camera.name}, {camera.city}
            <span className="block text-[11px] text-muted-fg">
              {camera.status === 'online' ? 'Online' : 'Offline'} - {camera.detections_today} deteksi hari ini
            </span>
          </Row>
        )}
      </div>

      {i.evidence && i.evidence.length > 0 && (
        <section aria-label="Frame bukti">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Frame bukti (wajah dan plat diblur)</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {i.evidence.slice(0, 4).map((src, idx) => (
              <img key={src} src={src} alt={`Frame bukti ${idx + 1}`} className="aspect-video w-full rounded-md object-cover" loading="lazy" />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="ai-h" className="rounded-xl border border-white/10 bg-card/70 p-3">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-fg" aria-hidden />
          <h3 id="ai-h" className="font-mono text-sm font-semibold">
            Verifikasi AI
          </h3>
          <span className="ml-auto">
            <VerifyBadge incident={i} />
          </span>
        </div>
        {v ? (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-[11px] text-muted-fg">Verdict</div>
                <div className="font-medium">{VERDICT_LABEL[v.verdict]}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-fg">Confidence</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium tabular">{pct(v.confidence)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full origin-left rounded-full"
                      style={{ transform: `scaleX(${v.confidence})`, background: v.confidence >= 0.8 ? '#22C55E' : v.confidence >= 0.5 ? '#EAB308' : '#94A3B8' }}
                    />
                  </span>
                </div>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-[#CBD5E1]">{v.reasoning}</p>
            <div className="text-xs text-muted-fg">
              Rekomendasi instansi: <span className="text-fg">{v.recommended_agency}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ModelTag model={v.model} simulated={v.simulated} />
              <span className="text-[11px] text-muted-fg">tahap {v.stage === 'verify' ? '2 (verifikasi final)' : '1 (filter cepat)'}</span>
            </div>
            {v.needs_manual_review && (
              <p className="rounded-lg bg-sev-medium/10 px-2.5 py-2 text-xs text-sev-medium">Butuh cek manual operator sebelum diteruskan ke 112.</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-fg">
            {i.verifying ? 'Sedang diverifikasi (tahap 1: filter cepat).' : 'Data dari sumber resmi, tidak melalui verifikasi AI.'}
          </p>
        )}
      </section>

      {i.dispatch && <DispatchTimeline dispatch={i.dispatch} onConfirm={onConfirm} onCancel={onCancel} />}
    </div>
  )
}
