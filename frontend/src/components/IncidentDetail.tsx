import type { ReactNode } from 'react'
import { ArrowLeft, Bot, LocateFixed } from 'lucide-react'
import type { Camera, Incident } from '../types'
import { HAZARDS, SEVERITY, SOURCE_KIND_LABEL } from '../lib/hazards'
import { effectiveSeverity } from '../lib/sort'
import { coord, dateTimeWIB, timeAgo } from '../lib/format'
import { HazardBadge, SegmentBar, SeverityTag, VerifyBadge } from './bits'
import { DispatchTimeline } from './DispatchTimeline'

interface Props {
  incident: Incident
  camera?: Camera
  onBack: () => void
  onFocus: () => void
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
}

const VERDICT = {
  confirmed: { label: 'Terkonfirmasi', color: '#3CCF7E' },
  false_alarm: { label: 'False alarm', color: '#929AA4' },
  uncertain: { label: 'Belum pasti', color: '#EAB308' },
} as const

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2.5 text-[13px]">
      <dt className="text-muted-fg">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  )
}

export function IncidentDetail({ incident: i, camera, onBack, onFocus, onConfirm, onCancel }: Props) {
  const v = i.verification
  const sev = effectiveSeverity(i)
  return (
    <article aria-labelledby="detail-title">
      <div className="flex h-11 items-center justify-between border-b border-line pr-1">
        <button type="button" onClick={onBack} className="flex h-11 items-center gap-2 px-3 text-sm font-semibold text-dim transition-colors duration-150 hover:text-fg">
          <ArrowLeft size={16} aria-hidden /> Semua kejadian
        </button>
        <button
          type="button"
          onClick={onFocus}
          aria-label="Pusatkan peta ke lokasi kejadian"
          title="Pusatkan peta"
          className="grid h-9 w-9 place-items-center text-dim transition-colors duration-150 hover:bg-raised hover:text-fg"
        >
          <LocateFixed size={16} aria-hidden />
        </button>
      </div>

      <header className="relative px-4 pb-4 pt-4">
        <span className="absolute inset-y-4 left-0 w-[3px]" style={{ background: SEVERITY[sev].color }} aria-hidden />
        <div className="flex items-center gap-3">
          <HazardBadge type={i.type} size={36} solid={sev === 'critical'} />
          <div>
            <SeverityTag severity={sev} />
            <p className="sign text-[12px]" style={{ color: HAZARDS[i.type].color }}>
              {HAZARDS[i.type].label}
            </p>
          </div>
        </div>
        <h2 id="detail-title" className="mt-3 font-display text-[24px] font-semibold leading-tight">
          {i.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-dim">{i.description}</p>
      </header>

      <dl className="px-4 pb-2">
        <Field label="Lokasi">
          {i.address}
          <span className="block text-xs text-muted-fg tabular">{coord(i.lat, i.lng)}</span>
        </Field>
        <Field label="Sumber">
          {i.source.label}
          <span className="block text-xs text-muted-fg">{SOURCE_KIND_LABEL[i.source.kind]}</span>
        </Field>
        <Field label="Dilaporkan">
          <span className="tabular">{dateTimeWIB(i.reported_at)}</span> <span className="text-muted-fg">({timeAgo(i.reported_at)})</span>
        </Field>
        {i.magnitude !== undefined && (
          <Field label="Magnitudo">
            <span className="tabular">M {i.magnitude.toFixed(1).replace('.', ',')}</span>
          </Field>
        )}
        {camera && (
          <Field label="Kamera">
            {camera.name}, {camera.city}
            <span className="block text-xs text-muted-fg">
              {camera.status === 'online' ? 'Online' : 'Offline'}, <span className="tabular">{camera.detections_today}</span> deteksi hari ini
            </span>
          </Field>
        )}
      </dl>

      {i.evidence && i.evidence.length > 0 && (
        <section aria-labelledby="ev-h" className="border-t border-line px-4 py-4">
          <h3 id="ev-h" className="sign mb-2 text-[13px] text-muted-fg">
            Frame bukti <span className="normal-case tracking-normal">(wajah dan plat diblur)</span>
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {i.evidence.slice(0, 4).map((src, idx) => (
              <img key={src} src={src} alt={`Frame bukti ${idx + 1}`} className="aspect-video w-full object-cover" loading="lazy" />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="ai-h" className="border-t border-line px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="ai-h" className="sign text-[13px] text-muted-fg">
            Verifikasi AI
          </h3>
          {!v && <VerifyBadge incident={i} />}
        </div>
        {v ? (
          <>
            <div className="mt-2 flex items-end justify-between gap-4">
              <p className="font-display text-[26px] font-bold uppercase leading-none" style={{ color: VERDICT[v.verdict].color }}>
                {VERDICT[v.verdict].label}
              </p>
              <div className="text-right">
                <p className="font-display text-[26px] font-bold leading-none tabular">
                  {Math.round(v.confidence * 100)}
                  <span className="text-base text-muted-fg">%</span>
                </p>
                <div className="mt-1.5">
                  <SegmentBar value={v.confidence} color={v.confidence >= 0.8 ? '#3CCF7E' : v.confidence >= 0.5 ? '#EAB308' : '#929AA4'} />
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-dim">{v.reasoning}</p>
            <dl className="mt-3">
              <Field label="Rekomendasi">{v.recommended_agency}</Field>
              <Field label="Model">
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <Bot size={13} className="text-muted-fg" aria-hidden />
                  {v.model}
                  {v.simulated && <span className="sign text-[11px] text-sev-medium">Simulasi</span>}
                </span>
                <span className="block text-xs text-muted-fg">{v.stage === 'verify' ? 'Tahap 2, verifikasi final' : 'Tahap 1, filter cepat'}</span>
              </Field>
            </dl>
            {v.needs_manual_review && <p className="mt-3 border-l-2 border-sev-medium pl-3 text-sm text-sev-medium">Butuh cek manual operator sebelum diteruskan ke 112.</p>}
          </>
        ) : (
          <p className="mt-2 text-sm text-dim">{i.verifying ? 'Sedang diverifikasi, tahap 1 filter cepat.' : 'Data dari sumber resmi, tidak melalui verifikasi AI.'}</p>
        )}
      </section>

      {i.dispatch && <DispatchTimeline dispatch={i.dispatch} onConfirm={onConfirm} onCancel={onCancel} />}
    </article>
  )
}
