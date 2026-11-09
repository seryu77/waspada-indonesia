import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { CircleCheck, Inbox, MapPin, MessageCircleQuestion, Send, X } from 'lucide-react'
import type { Incident, MyReport } from '../types'
import { HAZARDS } from '../lib/hazards'
import { clockWIB, dateTimeWIB, timeAgo } from '../lib/format'
import { citizenStatus, citizenSteps, hasOpenQuestion, thread } from '../lib/citizen'
import { HazardBadge } from './bits'

interface Props {
  reports: MyReport[]
  incidents: Incident[]
  /** Kejadian yang dibuka langsung (misal dari notifikasi) */
  openId?: string | null
  onReply: (id: string, text: string) => Promise<void>
  onLocate: (id: string) => void
  onClose: () => void
}

function Steps({ incident }: { incident: Incident }) {
  const steps = citizenSteps(incident)
  return (
    <ol className="mt-3" aria-label="Perjalanan laporan">
      {steps.map((s, idx) => (
        <li key={s.label} className="relative grid grid-cols-[18px_1fr] gap-3 pb-3 last:pb-0">
          {idx < steps.length - 1 && (
            <span className="absolute bottom-0 left-[8px] top-5 w-0.5" style={{ background: steps[idx + 1].done ? '#3CCF7E' : 'rgb(255 255 255 / 0.12)' }} aria-hidden />
          )}
          <span
            className="mt-0.5 grid h-[18px] w-[18px] place-items-center rounded-full"
            style={{ background: s.done ? '#3CCF7E' : 'transparent', boxShadow: s.done ? undefined : 'inset 0 0 0 1.5px rgb(255 255 255 / 0.25)' }}
            aria-hidden
          >
            {s.done && <CircleCheck size={12} color="#07140D" strokeWidth={3} />}
          </span>
          <div className="min-w-0">
            <p className="flex items-baseline justify-between gap-3">
              <span className={`text-[14px] ${s.current ? 'font-semibold text-fg' : s.done ? 'text-dim' : 'text-muted-fg'}`}>
                {s.label}
                <span className="sr-only">{s.done ? ', sudah' : ', belum'}</span>
              </span>
              {s.at && s.done && <span className="text-[11px] text-muted-fg tabular">{clockWIB(s.at)}</span>}
            </p>
            {s.note && <p className="mt-0.5 text-[13px] leading-snug text-dim">{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function Thread({ incident, onReply }: { incident: Incident; onReply: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const msgs = thread(incident)
  const asking = hasOpenQuestion(incident)
  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onReply(text.trim())
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengirim')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4">
      <h4 className="sign mb-2 text-[12px] text-muted-fg">Pesan dengan operator 112</h4>
      {msgs.length === 0 ? (
        <p className="text-[13px] text-muted-fg">Belum ada pesan. Operator akan menghubungi lewat sini kalau butuh info tambahan.</p>
      ) : (
        <ul className="space-y-2">
          {msgs.map((m, idx) => {
            const mine = m.author === 'pelapor'
            return (
              <li key={`${m.at}-${idx}`} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 ${mine ? 'rounded-br-sm bg-fg text-bg' : m.kind === 'question' ? 'rounded-bl-sm border border-[#38BDF8]/50 bg-[#0C2A3A]' : 'rounded-bl-sm bg-raised'}`}
                >
                  {!mine && (
                    <p className="sign mb-0.5 flex items-center gap-1 text-[11px]" style={{ color: m.kind === 'question' ? '#38BDF8' : '#3CCF7E' }}>
                      {m.kind === 'question' ? <MessageCircleQuestion size={12} aria-hidden /> : null}
                      {m.kind === 'question' ? 'Operator bertanya' : 'Pembaruan operator'}
                    </p>
                  )}
                  <p className="text-[13px] leading-snug">{m.text}</p>
                  <p className={`mt-0.5 text-right text-[10px] tabular ${mine ? 'text-bg/60' : 'text-muted-fg'}`}>{clockWIB(m.at)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {incident.status === 'active' && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[12px] text-dim">{asking ? 'Jawab pertanyaan operator' : 'Tambah info untuk operator (opsional)'}</span>
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
                }}
                rows={2}
                maxLength={500}
                placeholder={asking ? 'Tulis jawaban Anda' : 'Misal: air makin tinggi, ada warga terjebak'}
                className={`min-w-0 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-[13px] text-fg placeholder:text-muted-fg focus:outline-none ${asking ? 'border-[#38BDF8]/60' : 'border-line focus:border-line-strong'}`}
              />
              <button
                type="submit"
                disabled={busy || !text.trim()}
                aria-label="Kirim pesan"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-fg text-bg transition-opacity disabled:opacity-40"
              >
                <Send size={16} aria-hidden />
              </button>
            </div>
          </label>
          {error && (
            <p role="alert" className="mt-1.5 text-[12px] text-sev-critical">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}

export function MyReports({ reports, incidents, openId, onReply, onLocate, onClose }: Props) {
  const [expanded, setExpanded] = useState<string | null>(openId ?? reports[0]?.id ?? null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const items = reports.map((r) => ({ r, inc: incidents.find((i) => i.id === r.id) }))

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="mine-h"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%', transition: { duration: 0.18 } }}
        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        className="glass-strong fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col"
      >
        <div className="flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 id="mine-h" className="sign flex items-center gap-2 text-[16px]">
            <Inbox size={17} aria-hidden /> Laporan saya
          </h2>
          <button type="button" onClick={onClose} aria-label="Tutup" className="grid h-9 w-9 place-items-center text-dim hover:text-fg">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-6 py-12 text-center text-[13px] text-muted-fg">Belum ada laporan dari perangkat ini. Klik Lapor kejadian untuk mengirim laporan.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map(({ r, inc }) => {
                if (!inc) {
                  return (
                    <li key={r.id} className="px-4 py-3 text-[13px] text-muted-fg">
                      Laporan {dateTimeWIB(r.at)} tidak lagi tersedia di server (mungkin server dimulai ulang).
                    </li>
                  )
                }
                const st = citizenStatus(inc)
                const open = expanded === inc.id
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : inc.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${open ? 'bg-raised' : 'hover:bg-raised/60'}`}
                    >
                      <HazardBadge type={inc.type} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{HAZARDS[inc.type].label}</span>
                        <span className="block truncate text-[12px] text-muted-fg">
                          {timeAgo(inc.reported_at)}, {inc.description}
                        </span>
                      </span>
                      <span className="sign shrink-0 text-[11px]" style={{ color: st.color }}>
                        {st.label}
                      </span>
                    </button>
                    {open && (
                      <div className="px-4 pb-4">
                        <Steps incident={inc} />
                        <button
                          type="button"
                          onClick={() => onLocate(inc.id)}
                          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded px-2 text-[12px] text-dim hover:bg-raised hover:text-fg"
                        >
                          <MapPin size={13} aria-hidden /> Lihat di peta
                        </button>
                        <Thread incident={inc} onReply={(text) => onReply(inc.id, text)} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <p className="shrink-0 border-t border-line px-4 py-2.5 text-[11px] leading-snug text-muted-fg">
          Riwayat laporan disimpan di browser ini. Dalam keadaan darurat yang mengancam nyawa, tetap hubungi 112.
        </p>
      </motion.aside>
    </>
  )
}
