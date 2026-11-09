import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { Bot, WifiOff } from 'lucide-react'
import type { AutomationRules } from './types'
import { useLiveData, type CloseReason } from './store/useLiveData'
import { effectiveSeverity } from './lib/sort'
import { useMedia, useNow } from './lib/hooks'
import { buildActivity, fmtDuration, kpis, type ActivityEvent, type QueueTab } from './lib/operator'
import { TopBar } from './components/TopBar'
import { Toasts } from './components/Toasts'
import { WorkQueue } from './components/dashboard/WorkQueue'
import { ActivityLog } from './components/dashboard/ActivityLog'
import { Workspace, WorkspaceEmpty } from './components/dashboard/Workspace'
import { AutomationPanel } from './components/dashboard/AutomationPanel'
import { Pane } from './components/dashboard/ui'

const pct = (v: number) => `${Math.round(v * 100)}%`
const RULE_TEXT: Record<keyof AutomationRules, (v: never) => string> = {
  auto_dispatch_enabled: (v: boolean) => `auto-dispatch ${v ? 'aktif' : 'dimatikan'}`,
  auto_dispatch_min: (v: number) => `ambang auto-dispatch ${pct(v)}`,
  countdown_s: (v: number) => `hitung mundur ${v} dtk`,
  false_alarm_hide_min: (v: number) => `sembunyikan false alarm dari ${pct(v)}`,
  citizen_requires_review: (v: boolean) => `laporan warga ${v ? 'wajib' : 'tidak wajib'} validasi`,
  official_quake_auto: (v: boolean) => `gempa BMKG M6+ ${v ? 'langsung hitung mundur' : 'lewat validasi'}`,
}

function Kpi({ label, value, sub, color, onClick }: { label: string; value: string | number; sub?: string; color?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="font-display text-[26px] font-semibold leading-none tabular" style={{ color }}>
        {value}
      </span>
      <span className="sign mt-1 block text-[11px] text-muted-fg">{label}</span>
      {sub && <span className="block text-[11px] text-muted-fg">{sub}</span>}
    </>
  )
  const cls = 'flex flex-auto flex-col justify-start whitespace-nowrap border-l border-line px-4 py-2.5 text-left first:border-l-0'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-raised/60`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export default function OperatorDashboard() {
  const live = useLiveData({ operator: true })
  const { snapshot } = live
  const desktop = useMedia('(min-width: 900px)')
  const xl = useMedia('(min-width: 1280px)')
  const split = useMedia('(min-width: 1680px)')
  const now = useNow(15_000)

  const [tab, setTab] = useState<QueueTab>('review')
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get('incident'))
  const [centerTab, setCenterTab] = useState<'work' | 'log'>('work')
  const [mobilePane, setMobilePane] = useState<'queue' | 'work' | 'log'>(() => (selectedId ? 'work' : 'queue'))
  const [autoOpen, setAutoOpen] = useState(false)
  const [ruleEvents, setRuleEvents] = useState<ActivityEvent[]>([])
  const visibleIds = useRef<string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  const incidents = snapshot.incidents
  const selected = selectedId ? (incidents.find((i) => i.id === selectedId) ?? null) : null
  const k = useMemo(() => kpis(incidents, now), [incidents, now])
  const activity = useMemo(() => buildActivity(incidents, ruleEvents), [incidents, ruleEvents])
  const stats = useMemo(() => {
    const active = incidents.filter((i) => i.status === 'active')
    return {
      active: active.length,
      critical: active.filter((i) => effectiveSeverity(i) === 'critical').length,
      dispatched: active.filter((i) => i.dispatch?.state === 'sent').length,
      review: active.filter((i) => i.dispatch?.state === 'review').length,
    }
  }, [incidents])

  // Perubahan aturan (dari operator ini atau operator lain lewat WebSocket) masuk ke log aktivitas
  const prevRules = useRef(live.rules)
  useEffect(() => {
    const prev = prevRules.current
    prevRules.current = live.rules
    if (prev === live.rules) return
    const changed = (Object.keys(live.rules) as (keyof AutomationRules)[]).filter((key) => prev[key] !== live.rules[key])
    if (changed.length === 0) return
    const at = new Date().toISOString()
    setRuleEvents((e) => [
      {
        id: `rules:${at}`,
        at,
        actor: 'operator',
        text: `Aturan otomasi diubah: ${changed.map((key) => (RULE_TEXT[key] as (v: unknown) => string)(live.rules[key])).join(', ')}`,
        tone: 'warn',
      },
      ...e,
    ])
  }, [live.rules])

  const select = useCallback(
    (id: string) => {
      setSelectedId(id)
      setCenterTab('work')
      if (!desktop) setMobilePane('work')
      const url = new URL(location.href)
      url.searchParams.set('incident', id)
      history.replaceState(null, '', url)
    },
    [desktop],
  )

  // Navigasi keyboard: J/K pindah kejadian di antrean, / ke kotak cari
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || autoOpen) return
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key !== 'j' && e.key !== 'k') return
      const ids = visibleIds.current
      if (ids.length === 0) return
      const idx = selectedId ? ids.indexOf(selectedId) : -1
      const next = e.key === 'j' ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx === -1 ? 0 : idx - 1)
      select(ids[next])
      document.querySelector(`[data-incident="${CSS.escape(ids[next])}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select, selectedId, autoOpen])

  const bulkReject = useCallback(async (ids: string[]) => void (await Promise.allSettled(ids.map((id) => live.cancelDispatch(id)))), [live])
  const bulkClose = useCallback(
    async (ids: string[], reason: CloseReason) => void (await Promise.allSettled(ids.map((id) => live.resolveIncident(id, reason)))),
    [live],
  )
  const onVisible = useCallback((ids: string[]) => {
    visibleIds.current = ids
  }, [])

  const queue = (
    <WorkQueue
      incidents={incidents}
      tab={tab}
      setTab={setTab}
      selectedId={selectedId}
      onSelect={select}
      onVisibleChange={onVisible}
      onBulkReject={bulkReject}
      onBulkClose={bulkClose}
      searchRef={searchRef}
      className="h-full"
    />
  )
  const log = <ActivityLog events={activity} connection={live.connection} onSelect={select} incidentId={selectedId} className="h-full" />
  const workspace = (
    <Pane label="Ruang kerja" className="h-full">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            <Workspace
              incident={selected}
              snapshot={snapshot}
              offline={live.offline}
              rules={live.rules}
              wide={split}
              onSelect={select}
              onBack={desktop ? undefined : () => setMobilePane('queue')}
              onConfirm={() => live.confirmDispatch(selected.id)}
              onCancel={() => live.cancelDispatch(selected.id)}
              onManual={() => live.manualDispatch(selected.id)}
              onResolve={(reason, note) => live.resolveIncident(selected.id, reason, note)}
              onNote={(text, kind) => live.addNote(selected.id, text, kind)}
            />
          </motion.div>
        ) : (
          <WorkspaceEmpty incidents={incidents} onSelect={select} />
        )}
      </div>
    </Pane>
  )

  const autoBtn = (
    <button
      type="button"
      onClick={() => setAutoOpen(true)}
      className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-dim transition-colors duration-150 hover:border-fg hover:text-fg"
    >
      <Bot size={16} aria-hidden />
      <span className="hidden sm:inline">Otomasi</span>
      {!live.rules.auto_dispatch_enabled && <span className="h-2 w-2 bg-sev-medium" title="Auto-dispatch dimatikan" aria-label="Auto-dispatch dimatikan" />}
    </button>
  )

  const segBtn = (on: boolean) => `h-8 flex-1 rounded-md px-3 text-[13px] font-semibold transition-colors ${on ? 'bg-fg text-bg' : 'text-dim hover:text-fg'}`

  return (
    <MotionConfig reducedMotion="user">
      <main
        className="flex h-full flex-col gap-2 overflow-hidden p-2 min-[900px]:gap-3 min-[900px]:p-3"
        style={{ background: 'radial-gradient(1200px 600px at 15% -10%, rgb(56 189 248 / 0.07), transparent 60%), radial-gradient(900px 500px at 100% 110%, rgb(242 85 90 / 0.06), transparent 60%), #0b0d10' }}
      >
        <TopBar connection={live.connection} lastUpdate={live.lastUpdate} stats={stats} onReport={() => {}} operator view="dashboard" actions={autoBtn} />

        <AnimatePresence initial={false}>
          {live.offline && (
            <motion.div
              key="offline"
              role="status"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0, transition: { duration: 0.15 } }}
              className="shrink-0 overflow-hidden rounded-xl border border-[#6B4E0E] bg-[#3A2A06]/70"
            >
              <p className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[#FDE68A]">
                <WifiOff size={14} aria-hidden />
                <span className="sign text-[13px]">Mode offline</span>
                Server tidak terjangkau. Aksi operator disimpan di browser ini saja.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass scroll-thin flex shrink-0 overflow-x-auto rounded-2xl" aria-label="Ringkasan kerja">
          <Kpi label="Butuh validasi" value={k.review} color={k.review ? '#EAB308' : undefined} onClick={() => setTab('review')} />
          <Kpi label="Hitung mundur" value={k.countdown} color={k.countdown ? '#F2555A' : undefined} onClick={() => setTab('countdown')} />
          <Kpi
            label="Laporan warga aktif"
            value={k.citizen}
            sub={k.awaitingReply ? `${k.awaitingReply} pelapor menunggu balasan` : undefined}
            color={k.awaitingReply ? '#38BDF8' : undefined}
            onClick={() => setTab('citizen')}
          />
          <Kpi label="Terkirim 24 jam" value={k.sent} color="#3CCF7E" />
          <Kpi label="Ditolak / false alarm" value={k.rejected} sub="24 jam" />
          <Kpi label="Median waktu keputusan" value={k.medianDecision === null ? '-' : fmtDuration(k.medianDecision)} sub="antrean sampai operator memutuskan" />
          <Kpi
            label="Auto-dispatch"
            value={live.rules.auto_dispatch_enabled ? pct(live.rules.auto_dispatch_min) : 'Mati'}
            color={live.rules.auto_dispatch_enabled ? undefined : '#EAB308'}
            sub={live.rules.auto_dispatch_enabled ? `ambang, hitung mundur ${live.rules.countdown_s} dtk` : 'semua lewat validasi'}
            onClick={() => setAutoOpen(true)}
          />
        </div>

        {!desktop && (
          <div className="glass flex shrink-0 gap-1 rounded-xl p-1" role="tablist" aria-label="Panel">
            {(
              [
                ['queue', `Antrean${k.review ? ` (${k.review})` : ''}`],
                ['work', 'Ruang kerja'],
                ['log', 'Log'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mobilePane === id} onClick={() => setMobilePane(id)} className={segBtn(mobilePane === id)}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
            <Toasts toasts={live.newCritical} onOpen={select} onDismiss={live.dismissToast} />
          </div>

          {!desktop ? (
            <div className="h-full">{mobilePane === 'queue' ? queue : mobilePane === 'work' ? workspace : log}</div>
          ) : xl ? (
            <div className="grid h-full grid-cols-[minmax(320px,360px)_minmax(0,1fr)_minmax(300px,360px)] gap-3">
              {queue}
              {workspace}
              {log}
            </div>
          ) : (
            <div className="grid h-full grid-cols-[minmax(300px,340px)_minmax(0,1fr)] gap-3">
              {queue}
              <div className="flex min-h-0 flex-col gap-2">
                <div className="glass flex shrink-0 gap-1 rounded-xl p-1" role="tablist" aria-label="Panel tengah">
                  <button type="button" role="tab" aria-selected={centerTab === 'work'} onClick={() => setCenterTab('work')} className={segBtn(centerTab === 'work')}>
                    Ruang kerja
                  </button>
                  <button type="button" role="tab" aria-selected={centerTab === 'log'} onClick={() => setCenterTab('log')} className={segBtn(centerTab === 'log')}>
                    Log aktivitas
                  </button>
                </div>
                <div className="min-h-0 flex-1">{centerTab === 'work' ? workspace : log}</div>
              </div>
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {autoOpen && (
          <AutomationPanel
            key="auto"
            rules={live.rules}
            incidents={incidents}
            offline={live.offline}
            onSave={live.updateRules}
            onClose={() => setAutoOpen(false)}
          />
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}
