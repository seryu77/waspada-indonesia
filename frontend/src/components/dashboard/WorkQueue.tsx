import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, CircleCheck, MessageCircle, Search, X } from 'lucide-react'
import type { HazardType, Incident, SourceKind } from '../../types'
import { HAZARDS, HAZARD_ORDER, SEVERITY, SOURCE_KIND_LABEL } from '../../lib/hazards'
import { effectiveSeverity } from '../../lib/sort'
import { timeAgo } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import { QUEUE_TABS, awaitingOperator, inTab, isPending, matchesQuery, sortForTab, waitingSince, workStatus, type QueueTab } from '../../lib/operator'
import { HazardBadge } from '../bits'
import { ConfirmBtn, Pane, PaneHeader, StatusChip } from './ui'

interface Props {
  incidents: Incident[]
  tab: QueueTab
  setTab: (t: QueueTab) => void
  selectedId: string | null
  onSelect: (id: string) => void
  /** Daftar yang sedang terlihat, untuk navigasi keyboard J/K di halaman */
  onVisibleChange: (ids: string[]) => void
  onBulkReject: (ids: string[]) => Promise<void>
  onBulkClose: (ids: string[], reason: 'handled' | 'false_alarm') => Promise<void>
  searchRef: React.RefObject<HTMLInputElement | null>
  className?: string
}

const selectCls = 'h-8 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-[13px] text-dim [&>option]:bg-panel'

export function WorkQueue({ incidents, tab, setTab, selectedId, onSelect, onVisibleChange, onBulkReject, onBulkClose, searchRef, className }: Props) {
  const now = useNow(1000)
  const [q, setQ] = useState('')
  const [hazard, setHazard] = useState<HazardType | ''>('')
  const [source, setSource] = useState<SourceKind | ''>('')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const counts = useMemo(() => Object.fromEntries(QUEUE_TABS.map((t) => [t.id, incidents.filter((i) => inTab(i, t.id)).length])) as Record<QueueTab, number>, [incidents])

  const list = useMemo(
    () =>
      sortForTab(
        incidents.filter((i) => inTab(i, tab) && matchesQuery(i, q) && (!hazard || i.type === hazard) && (!source || i.source.kind === source)),
        tab,
      ).slice(0, 200),
    [incidents, tab, q, hazard, source],
  )

  const ids = list.map((i) => i.id).join('|')
  const visibleRef = useRef(onVisibleChange)
  useEffect(() => {
    visibleRef.current = onVisibleChange
  })
  useEffect(() => {
    visibleRef.current(ids ? ids.split('|') : [])
  }, [ids])

  // Hanya centang yang masih terlihat yang dihitung, supaya aksi massal tidak mengenai kejadian tersembunyi
  const checkedList = list.filter((i) => checked.has(i.id))
  const pendingChecked = checkedList.filter(isPending).map((i) => i.id)
  const closable = checkedList.filter((i) => i.status === 'active').map((i) => i.id)
  const closableHandled = checkedList.filter((i) => i.status === 'active' && !isPending(i)).map((i) => i.id)
  const allChecked = list.length > 0 && list.every((i) => checked.has(i.id))
  const tabMeta = QUEUE_TABS.find((t) => t.id === tab)!

  const toggle = (id: string) =>
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Pane label="Antrean kerja" className={className}>
      <PaneHeader title="Antrean kerja" aside={<span className="text-xs text-muted-fg tabular">{list.length} ditampilkan</span>}>
        <div role="tablist" aria-label="Kategori antrean" className="scroll-thin flex gap-1 overflow-x-auto px-2 pb-2">
          {QUEUE_TABS.map((t) => {
            const on = t.id === tab
            const hot = (t.id === 'review' || t.id === 'countdown') && counts[t.id] > 0
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={on}
                title={t.hint}
                onClick={() => setTab(t.id)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors ${
                  on ? 'bg-fg text-bg' : 'text-dim hover:bg-raised hover:text-fg'
                }`}
              >
                {t.label}
                <span
                  className={`min-w-5 rounded px-1 text-center text-[11px] tabular ${on ? 'bg-bg/15' : hot ? (t.id === 'review' ? 'bg-sev-medium text-bg' : 'bg-sev-critical text-white') : 'bg-raised'}`}
                >
                  {counts[t.id]}
                </span>
              </button>
            )
          })}
        </div>
        <div className="space-y-2 px-3 pb-3">
          <label className="relative block">
            <span className="sr-only">Cari kejadian</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" aria-hidden />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.currentTarget.blur())}
              placeholder="Cari judul, lokasi, ID ( / )"
              className="h-8 w-full rounded-md border border-line bg-transparent pl-8 pr-7 text-[13px] text-fg placeholder:text-muted-fg focus:border-line-strong focus:outline-none"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Hapus pencarian" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center text-muted-fg hover:text-fg">
                <X size={13} aria-hidden />
              </button>
            )}
          </label>
          <div className="flex gap-2">
            <select aria-label="Filter jenis bahaya" value={hazard} onChange={(e) => setHazard(e.target.value as HazardType | '')} className={selectCls}>
              <option value="">Semua jenis</option>
              {HAZARD_ORDER.map((h) => (
                <option key={h} value={h}>
                  {HAZARDS[h].label}
                </option>
              ))}
            </select>
            <select aria-label="Filter sumber" value={source} onChange={(e) => setSource(e.target.value as SourceKind | '')} className={selectCls}>
              <option value="">Semua sumber</option>
              {(Object.keys(SOURCE_KIND_LABEL) as SourceKind[]).map((k) => (
                <option key={k} value={k}>
                  {SOURCE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </PaneHeader>

      <AnimatePresence initial={false}>
        {checkedList.length > 0 && (
          <motion.div
            key="bulk"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0, transition: { duration: 0.12 } }}
            className="shrink-0 overflow-hidden border-b border-line bg-raised/50"
          >
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="mr-auto text-[13px] font-semibold tabular">{checkedList.length} dipilih</span>
              {pendingChecked.length > 0 && (
                <ConfirmBtn confirmLabel={`Tolak ${pendingChecked.length}?`} onConfirm={() => onBulkReject(pendingChecked)} className="h-8 px-2.5 text-[13px]">
                  <Ban size={14} aria-hidden /> Tolak dispatch
                </ConfirmBtn>
              )}
              {closable.length > 0 && (
                <ConfirmBtn confirmLabel={`Tutup ${closable.length}?`} onConfirm={() => onBulkClose(closable, 'false_alarm')} className="h-8 px-2.5 text-[13px]">
                  <X size={14} aria-hidden /> False alarm
                </ConfirmBtn>
              )}
              {closableHandled.length > 0 && (
                <ConfirmBtn confirmLabel={`Tutup ${closableHandled.length}?`} onConfirm={() => onBulkClose(closableHandled, 'handled')} className="h-8 px-2.5 text-[13px]">
                  <CircleCheck size={14} aria-hidden /> Selesai
                </ConfirmBtn>
              )}
              <button type="button" onClick={() => setChecked(new Set())} className="text-[12px] text-muted-fg underline underline-offset-2 hover:text-fg">
                Batal pilih
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {list.length > 0 && (
          <label className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[12px] text-muted-fg">
            <input
              type="checkbox"
              className="check"
              checked={allChecked}
              onChange={() => setChecked(allChecked ? new Set() : new Set(list.map((i) => i.id)))}
            />
            Pilih semua di tab ini
          </label>
        )}
        {list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="sign text-[14px] text-dim">Kosong</p>
            <p className="mt-1 text-[13px] text-muted-fg">{q || hazard || source ? 'Tidak ada yang cocok dengan filter.' : tabMeta.hint}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label={`Antrean ${tabMeta.label}`}>
            {list.map((i) => {
              const sev = effectiveSeverity(i)
              const st = workStatus(i)
              const active = i.id === selectedId
              const secs = i.dispatch?.state === 'countdown' && i.dispatch.deadline ? Math.max(0, Math.ceil((Date.parse(i.dispatch.deadline) - now) / 1000)) : null
              return (
                <li key={i.id} className={`relative flex items-stretch ${active ? 'bg-raised' : 'hover:bg-raised/60'}`}>
                  <span className="w-[3px] shrink-0" style={{ background: sev === 'critical' || sev === 'high' ? SEVERITY[sev].color : 'transparent' }} aria-hidden />
                  <label className="flex shrink-0 items-start px-2.5 pt-3.5">
                    <span className="sr-only">Pilih {i.title}</span>
                    <input type="checkbox" className="check" checked={checked.has(i.id)} onChange={() => toggle(i.id)} />
                  </label>
                  <button
                    type="button"
                    onClick={() => onSelect(i.id)}
                    aria-current={active ? 'true' : undefined}
                    data-incident={i.id}
                    className="grid min-w-0 flex-1 grid-cols-[28px_1fr] gap-x-2.5 py-2.5 pr-3 text-left"
                  >
                    <HazardBadge type={i.type} size={28} solid={sev === 'critical'} />
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[14px] font-semibold leading-snug text-fg">{i.title}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-fg tabular">
                          {tab === 'review' ? `tunggu ${timeAgo(waitingSince(i), now).replace(' lalu', '')}` : timeAgo(i.reported_at, now)}
                        </span>
                      </span>
                      <span className="block truncate text-[12px] text-muted-fg">{i.address}</span>
                      <span className="mt-1 flex items-center gap-3">
                        <StatusChip label={secs !== null ? `${st.label} ${secs} dtk` : st.label} tone={st.tone} />
                        {awaitingOperator(i) && (
                          <span className="sign inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-[#38BDF8]">
                            <MessageCircle size={11} aria-hidden /> Pelapor membalas
                          </span>
                        )}
                        {i.verification && (
                          <span className="text-[11px] text-dim tabular" title="Kepastian AI">
                            AI {Math.round(i.verification.confidence * 100)}%
                          </span>
                        )}
                        <span className="ml-auto truncate text-[11px] text-muted-fg">{SOURCE_KIND_LABEL[i.source.kind]}</span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="hidden shrink-0 border-t border-line px-4 py-1.5 text-[11px] text-muted-fg min-[900px]:block">
        <kbd className="font-sans font-semibold text-dim">J</kbd>/<kbd className="font-sans font-semibold text-dim">K</kbd> pindah kejadian,{' '}
        <kbd className="font-sans font-semibold text-dim">/</kbd> cari
      </p>
    </Pane>
  )
}
