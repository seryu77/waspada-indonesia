import { useState } from 'react'
import { ArrowLeft, CircleCheck, Copy, Map as MapIcon, NotebookPen, Radar, Send } from 'lucide-react'
import type { AutomationRules, Incident, NoteKind, Snapshot } from '../../types'
import type { CloseReason } from '../../store/useLiveData'
import { HAZARDS, SEVERITY, SOURCE_KIND_LABEL } from '../../lib/hazards'
import { effectiveSeverity } from '../../lib/sort'
import { clockWIB, coord, dateTimeWIB, timeAgo } from '../../lib/format'
import { RESOLUTION_LABEL, TONE_COLOR, explainIndication, isPending, workStatus, type IndicationStep } from '../../lib/operator'
import { HazardBadge, SeverityTag } from '../bits'
import { DispatchTimeline } from '../DispatchTimeline'
import { EvidencePanel } from '../EvidencePanel'
import { Btn, ConfirmBtn, StatusChip } from './ui'

interface Props {
  incident: Incident
  snapshot: Snapshot
  offline: boolean
  rules: AutomationRules
  wide: boolean
  onSelect: (id: string) => void
  onBack?: () => void
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
  onManual: () => Promise<void>
  onResolve: (reason: CloseReason, note?: string) => Promise<void>
  onNote: (text: string, kind: Exclude<NoteKind, 'reply'>) => Promise<void>
}

/** Bar kepastian AI dengan garis ambang auto-dispatch, supaya terlihat seberapa jauh dari ambang */
function ConfidenceMeter({ value, threshold }: { value: number; threshold: number }) {
  const color = value >= threshold ? '#3CCF7E' : value >= 0.5 ? '#EAB308' : '#929AA4'
  return (
    <div className="mt-2">
      <div
        className="relative h-2.5 bg-line"
        role="meter"
        aria-label="Kepastian AI"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <div className="ticks absolute inset-y-0 left-0" style={{ width: `${value * 100}%`, background: color }} />
        <div className="absolute -bottom-1 -top-1 w-0.5 bg-fg" style={{ left: `${threshold * 100}%` }} aria-hidden />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted-fg tabular">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-dim" style={{ left: `${threshold * 100}%` }}>
          ambang auto {Math.round(threshold * 100)}%
        </span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  )
}

function Step({ step, n, last, children }: { step: IndicationStep; n: number; last: boolean; children?: React.ReactNode }) {
  const color = TONE_COLOR[step.tone]
  return (
    <li className="relative grid grid-cols-[24px_1fr] gap-3">
      {!last && <span className="absolute bottom-0 left-[11px] top-7 w-px bg-line-strong" aria-hidden />}
      <span className="grid h-6 w-6 place-items-center rounded-full border text-[12px] font-bold tabular" style={{ borderColor: color, color }} aria-hidden>
        {n}
      </span>
      <div className="min-w-0 pb-4">
        <p className="flex items-baseline justify-between gap-3">
          <span className="sign text-[12px] text-muted-fg">{step.title}</span>
          {step.at && <span className="text-[11px] text-muted-fg tabular">{clockWIB(step.at)}</span>}
        </p>
        <p className="mt-0.5 text-[14px] font-semibold leading-snug" style={{ color: step.tone === 'info' ? '#E9EBEE' : color }}>
          {step.headline}
        </p>
        {step.detail && <p className="mt-1 text-[13px] leading-relaxed text-dim">{step.detail}</p>}
        {children}
      </div>
    </li>
  )
}

function Indication({ incident, rules }: { incident: Incident; rules: AutomationRules }) {
  const steps = explainIndication(incident, rules)
  const v = incident.verification
  return (
    <section aria-labelledby="why-h" className="px-4 py-4">
      <h3 id="why-h" className="sign mb-3 flex items-center gap-2 text-[14px]">
        <Radar size={15} className="text-muted-fg" aria-hidden /> Kenapa terindikasi
      </h3>
      <ol>
        {steps.map((s, idx) => (
          <Step key={s.key} step={s} n={idx + 1} last={idx === steps.length - 1}>
            {s.key === 'verify' && v && (
              <>
                <ConfidenceMeter value={v.confidence} threshold={rules.auto_dispatch_min} />
                <p className="mt-1 text-[12px] text-muted-fg">
                  {v.model}, {v.stage === 'verify' ? 'tahap 2 verifikasi final' : 'tahap 1 filter cepat'}
                  {v.simulated && <span className="sign ml-2 text-[11px] text-sev-medium">Simulasi</span>}
                  {', rekomendasi '}
                  <span className="text-dim">{v.recommended_agency}</span>
                </p>
              </>
            )}
          </Step>
        ))}
      </ol>
      <p className="text-[11px] text-muted-fg">Bukti mentah (kondisi lokasi, CCTV, frame, kejadian sekitar) ada di panel Bukti pendukung.</p>
    </section>
  )
}

const CLOSE_OPTIONS: { reason: CloseReason; label: string; hint: string }[] = [
  { reason: 'handled', label: 'Sudah ditangani', hint: 'Petugas sudah di lokasi atau kejadian selesai' },
  { reason: 'false_alarm', label: 'False alarm', hint: 'Setelah dicek, tidak ada kejadian' },
  { reason: 'duplicate', label: 'Duplikat', hint: 'Sudah tercatat di kejadian lain' },
]

function Decision({ incident: i, rules, onConfirm, onCancel, onManual, onResolve }: Pick<Props, 'incident' | 'rules' | 'onConfirm' | 'onCancel' | 'onManual' | 'onResolve'>) {
  const [closing, setClosing] = useState<CloseReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = isPending(i)
  const canManual = i.status === 'active' && !pending && i.dispatch?.state !== 'sent'

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aksi gagal')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {i.dispatch && <DispatchTimeline dispatch={i.dispatch} confidence={i.verification?.confidence} autoMin={rules.auto_dispatch_min} onConfirm={onConfirm} onCancel={onCancel} />}

      {i.status === 'active' ? (
        <section aria-labelledby="act-h" className="border-t border-line px-4 py-4">
          <h3 id="act-h" className="sign mb-3 text-[13px] text-muted-fg">
            Tindakan operator
          </h3>
          {canManual && (
            <div className="mb-4">
              <ConfirmBtn variant="outline" confirmLabel="Klik lagi untuk kirim ke 112" onConfirm={() => run(onManual).then(() => undefined)} className="w-full">
                <Send size={15} aria-hidden /> Kirim manual ke 112
              </ConfirmBtn>
              <p className="mt-1.5 text-[12px] leading-snug text-muted-fg">
                Untuk kejadian yang tidak masuk dispatch otomatis (misal severity sedang) tapi menurut penilaian Anda perlu petugas.
              </p>
            </div>
          )}
          <p className="mb-2 text-[13px] text-dim">Tutup kejadian:</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Alasan menutup kejadian">
            {CLOSE_OPTIONS.map((o) => {
              const disabled = o.reason === 'handled' && pending
              return (
                <button
                  key={o.reason}
                  type="button"
                  role="radio"
                  aria-checked={closing === o.reason}
                  disabled={disabled}
                  title={disabled ? 'Putuskan dispatch 112 dulu' : o.hint}
                  onClick={() => setClosing(closing === o.reason ? null : o.reason)}
                  className={`min-h-9 rounded-lg border px-2 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40 ${
                    closing === o.reason ? 'border-fg bg-raised text-fg' : 'border-line-strong text-dim hover:border-fg hover:text-fg'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          {closing && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px] text-muted-fg">
                {CLOSE_OPTIONS.find((o) => o.reason === closing)!.hint}.
                {pending && ' Dispatch yang masih menunggu akan ditolak.'}
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Catatan (opsional), misal hasil cek lapangan"
                className="w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-fg placeholder:text-muted-fg focus:border-line-strong focus:outline-none"
              />
              <div className="flex gap-2">
                <Btn
                  variant="alarm"
                  disabled={busy}
                  className="flex-1"
                  onClick={async () => {
                    if (await run(() => onResolve(closing, note))) {
                      setClosing(null)
                      setNote('')
                    }
                  }}
                >
                  <CircleCheck size={15} aria-hidden /> Tutup sebagai {RESOLUTION_LABEL[closing].toLowerCase()}
                </Btn>
                <Btn variant="ghost" onClick={() => setClosing(null)}>
                  Batal
                </Btn>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 border-l-2 border-sev-critical pl-3 text-[13px] text-sev-critical">
              {error}
            </p>
          )}
        </section>
      ) : (
        <p className="flex items-center gap-2 border-t border-line px-4 py-4 text-[13px] text-dim" role="status">
          <CircleCheck size={16} className="text-muted-fg" aria-hidden />
          Ditutup {i.resolved_by === 'ai' ? 'oleh AI' : i.resolved_by === 'system' ? 'oleh sistem' : 'oleh operator'}
          {i.resolution && `: ${RESOLUTION_LABEL[i.resolution].toLowerCase()}`}
          {i.resolved_at && <span className="ml-auto text-[12px] text-muted-fg tabular">{dateTimeWIB(i.resolved_at)}</span>}
        </p>
      )}
    </div>
  )
}

type SendKind = Exclude<NoteKind, 'reply'>

const NOTE_STYLE: Record<NoteKind, { label: string; color: string }> = {
  note: { label: 'Internal', color: '#929AA4' },
  update: { label: 'Pembaruan publik', color: '#3CCF7E' },
  question: { label: 'Tanya pelapor', color: '#38BDF8' },
  reply: { label: 'Balasan pelapor', color: '#38BDF8' },
}

function Notes({ incident: i, onNote }: Pick<Props, 'incident' | 'onNote'>) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<SendKind>('note')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Hanya laporan dari aplikasi Awasana yang punya pelapor yang bisa dihubungi
  const canAsk = i.id.startsWith('rep-')
  const kinds: SendKind[] = canAsk ? ['note', 'update', 'question'] : ['note', 'update']
  const hint: Record<SendKind, string> = {
    note: 'Hanya terlihat operator.',
    update: 'Tampil di peta publik dan di Laporan saya milik pelapor.',
    question: 'Dikirim ke pelapor. Jawabannya muncul di sini dan di log aktivitas.',
  }
  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onNote(text.trim(), kind)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="notes-h" className="border-t border-line px-4 py-4">
      <h3 id="notes-h" className="sign mb-2 flex items-center gap-2 text-[13px] text-muted-fg">
        <NotebookPen size={14} aria-hidden /> Komunikasi dan catatan
      </h3>
      {i.notes && i.notes.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {i.notes.map((n, idx) => {
            const st = NOTE_STYLE[n.kind ?? 'note']
            const fromReporter = n.author === 'pelapor'
            return (
              <li
                key={`${n.at}-${idx}`}
                className={`border-l-2 pl-3 ${fromReporter ? 'rounded-r-lg bg-[#0C2A3A]/60 py-1.5 pr-2' : ''}`}
                style={{ borderColor: st.color }}
              >
                <p className="sign text-[11px]" style={{ color: st.color }}>
                  {fromReporter ? 'Pelapor' : st.label}
                </p>
                <p className="text-[13px] leading-relaxed text-fg">{n.text}</p>
                <p className="text-[11px] text-muted-fg tabular">{dateTimeWIB(n.at)}</p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mb-3 text-[13px] text-muted-fg">
          Belum ada catatan.{canAsk ? ' Laporan ini dari aplikasi Awasana, Anda bisa bertanya langsung ke pelapor.' : ''}
        </p>
      )}
      <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Jenis pesan">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`h-7 rounded-md px-2 text-[12px] font-semibold transition-colors ${kind === k ? 'bg-fg text-bg' : 'text-dim hover:bg-raised hover:text-fg'}`}
          >
            {NOTE_STYLE[k].label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex items-end gap-2"
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Tulis {NOTE_STYLE[kind].label.toLowerCase()}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
            }}
            rows={2}
            maxLength={500}
            placeholder={kind === 'question' ? 'Misal: Berapa tinggi air sekarang? Ada warga terjebak?' : kind === 'update' ? 'Misal: Petugas BPBD menuju lokasi' : 'Tulis catatan (Ctrl+Enter kirim)'}
            className="w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-fg placeholder:text-muted-fg focus:border-line-strong focus:outline-none"
          />
        </label>
        <Btn type="submit" variant={kind === 'note' ? 'outline' : 'alarm'} disabled={busy || !text.trim()}>
          {kind === 'note' ? 'Simpan' : 'Kirim'}
        </Btn>
      </form>
      <p className="mt-1.5 text-[11px] text-muted-fg">{hint[kind]}</p>
      {error && (
        <p role="alert" className="mt-1.5 text-[12px] text-sev-critical">
          {error}
        </p>
      )}
    </section>
  )
}

export function Workspace(props: Props) {
  const { incident: i, snapshot, offline, rules, wide, onSelect, onBack } = props
  const sev = effectiveSeverity(i)
  const st = workStatus(i)
  const [copied, setCopied] = useState(false)

  const header = (
    <header className="relative border-b border-line px-4 pb-4 pt-3">
      <span className="absolute inset-y-4 left-0 w-[3px]" style={{ background: SEVERITY[sev].color }} aria-hidden />
      <div className="flex items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className="-ml-1 mr-1 grid h-8 w-8 place-items-center text-dim hover:text-fg" aria-label="Kembali ke antrean">
            <ArrowLeft size={16} aria-hidden />
          </button>
        )}
        <StatusChip label={st.label} tone={st.tone} />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(i.id)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }}
            title="Salin ID kejadian"
            className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-[12px] text-muted-fg hover:bg-raised hover:text-fg"
          >
            <Copy size={12} aria-hidden /> <span className="tabular">{copied ? 'Tersalin' : i.id}</span>
          </button>
          <a
            href={`/operator?incident=${encodeURIComponent(i.id)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-[12px] text-dim hover:bg-raised hover:text-fg"
          >
            <MapIcon size={13} aria-hidden /> Lihat di peta
          </a>
        </div>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <HazardBadge type={i.type} size={40} solid={sev === 'critical'} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-3">
            <SeverityTag severity={sev} />
            <span className="sign text-[12px]" style={{ color: HAZARDS[i.type].color }}>
              {HAZARDS[i.type].label}
            </span>
          </p>
          <h2 id="ws-title" className="mt-0.5 font-display text-[24px] font-semibold leading-tight">
            {i.title}
          </h2>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-[11px] text-muted-fg">Lokasi</dt>
          <dd className="text-fg">
            {i.address}
            <span className="block text-[11px] text-muted-fg tabular">{coord(i.lat, i.lng)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-fg">Sumber</dt>
          <dd className="text-fg">
            {i.source.label}
            <span className="block text-[11px] text-muted-fg">
              {SOURCE_KIND_LABEL[i.source.kind]}, dilaporkan {dateTimeWIB(i.reported_at)} ({timeAgo(i.reported_at)})
            </span>
          </dd>
        </div>
      </dl>
    </header>
  )

  const left = (
    <>
      <Indication incident={i} rules={rules} />
      <div className="border-t border-line">
        <Decision {...props} />
      </div>
      <Notes incident={i} onNote={props.onNote} />
    </>
  )
  const evidence = <EvidencePanel key={i.id} incident={i} snapshot={snapshot} offline={offline} onSelect={onSelect} />

  return (
    <article aria-labelledby="ws-title">
      {header}
      {wide ? (
        <div className="grid grid-cols-2">
          <div className="min-w-0 border-r border-line">{left}</div>
          <div className="min-w-0 [&>div>div:first-child]:border-t-0">{evidence}</div>
        </div>
      ) : (
        <>
          {left}
          {evidence}
        </>
      )}
    </article>
  )
}

/** Tampilan ruang kerja saat belum ada kejadian dipilih: yang paling mendesak lebih dulu */
export function WorkspaceEmpty({ incidents, onSelect }: { incidents: Incident[]; onSelect: (id: string) => void }) {
  const urgent = incidents
    .filter((i) => i.status === 'active' && isPending(i))
    .sort((a, b) => (a.dispatch?.state === 'countdown' ? -1 : 0) - (b.dispatch?.state === 'countdown' ? -1 : 0))
    .slice(0, 6)
  return (
    <div className="px-6 py-10">
      <p className="sign text-[16px]">Pilih kejadian dari antrean</p>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-fg">
        Ruang kerja menampilkan kenapa kejadian terindikasi, bukti pendukung, dan tombol keputusan. Semua aksi tercatat di log aktivitas.
      </p>
      {urgent.length > 0 && (
        <>
          <h3 className="sign mb-2 mt-6 text-[13px] text-muted-fg">Menunggu keputusan sekarang</h3>
          <ul className="divide-y divide-line border-y border-line">
            {urgent.map((i) => {
              const st = workStatus(i)
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => onSelect(i.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-raised/60">
                    <HazardBadge type={i.type} size={26} solid={effectiveSeverity(i) === 'critical'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{i.title}</span>
                      <span className="block truncate text-[12px] text-muted-fg">{i.address}</span>
                    </span>
                    <StatusChip label={st.label} tone={st.tone} />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {urgent.length === 0 && (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-accent">
          <CircleCheck size={15} aria-hidden /> Tidak ada yang menunggu keputusan.
        </p>
      )}
    </div>
  )
}
