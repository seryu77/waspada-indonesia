import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Download } from 'lucide-react'
import type { Connection } from '../../types'
import { clockWIB } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import { ACTIVITY_ACTOR_LABEL, TONE_COLOR, activityCsv, downloadText, type ActivityActor, type ActivityEvent } from '../../lib/operator'
import { Pane, PaneHeader } from './ui'

interface Props {
  events: ActivityEvent[]
  connection: Connection
  onSelect: (id: string) => void
  /** Hanya tampilkan aktivitas satu kejadian */
  incidentId?: string | null
  className?: string
}

const FILTERS: (ActivityActor | 'all')[] = ['all', 'source', 'ai', 'operator', 'citizen', 'system']

export function ActivityLog({ events, connection, onSelect, incidentId, className }: Props) {
  const now = useNow(5000)
  const [actor, setActor] = useState<ActivityActor | 'all'>('all')
  const [onlySelected, setOnlySelected] = useState(false)
  // Event yang sudah ada saat log pertama dibuka tidak diberi sorotan "baru"
  const [firstIds] = useState(() => new Set(events.map((e) => e.id)))

  const shown = useMemo(
    () => events.filter((e) => (actor === 'all' || e.actor === actor) && (!onlySelected || !incidentId || e.incidentId === incidentId)),
    [events, actor, onlySelected, incidentId],
  )

  return (
    <Pane label="Log aktivitas" className={className}>
      <PaneHeader
        title={
          <>
            Log aktivitas
            {(connection === 'live' || connection === 'polling') && (
              <span className="relative flex h-2 w-2" aria-label="Langsung">
                <motion.span
                  className="absolute inset-0 bg-accent"
                  animate={{ opacity: [0.8, 0], scale: [1, 2.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                />
                <span className="relative h-2 w-2 bg-accent" />
              </span>
            )}
          </>
        }
        aside={
          <button
            type="button"
            onClick={() => downloadText(`awasana-log-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`, activityCsv(shown))}
            className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs text-dim transition-colors hover:bg-raised hover:text-fg"
          >
            <Download size={13} aria-hidden /> CSV
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2" role="group" aria-label="Filter pelaku">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={actor === f}
              onClick={() => setActor(f)}
              className={`h-7 rounded-md px-2 text-[12px] font-semibold transition-colors ${actor === f ? 'bg-fg text-bg' : 'text-dim hover:bg-raised hover:text-fg'}`}
            >
              {f === 'all' ? 'Semua' : ACTIVITY_ACTOR_LABEL[f]}
            </button>
          ))}
          {incidentId && (
            <label className="ml-auto flex items-center gap-1.5 px-1 text-[12px] text-dim">
              <input type="checkbox" className="check" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
              Kejadian terpilih
            </label>
          )}
        </div>
      </PaneHeader>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-6 py-12 text-center text-[13px] text-muted-fg">Belum ada aktivitas.</p>
        ) : (
          <ol aria-label="Aktivitas terbaru di atas">
            {shown.map((e) => {
              // Sorot hanya event yang benar-benar baru, bukan seluruh isi snapshot yang baru tiba dari server
              const fresh = !firstIds.has(e.id) && now - Date.parse(e.at) < 15_000
              const color = TONE_COLOR[e.tone]
              const mine = incidentId && e.incidentId === incidentId
              return (
                <li key={e.id} className={`relative border-b border-line ${mine ? 'bg-raised/60' : ''}`}>
                  {fresh && (
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{ background: color }}
                      initial={{ opacity: 0.2 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 1.6 }}
                    />
                  )}
                  <button
                    type="button"
                    disabled={!e.incidentId}
                    onClick={() => e.incidentId && onSelect(e.incidentId)}
                    className="relative grid w-full grid-cols-[56px_1fr] gap-2 px-3 py-2 text-left transition-colors enabled:hover:bg-raised/60 disabled:cursor-default"
                  >
                    <span className="pt-px text-[11px] text-muted-fg tabular">{clockWIB(e.at).replace(' WIB', '')}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="sign text-[11px]" style={{ color }}>
                          {ACTIVITY_ACTOR_LABEL[e.actor]}
                        </span>
                        {e.incidentTitle && <span className="truncate text-[11px] text-muted-fg">{e.incidentTitle}</span>}
                      </span>
                      <span className="block text-[13px] leading-snug text-fg">{e.text}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Pane>
  )
}
