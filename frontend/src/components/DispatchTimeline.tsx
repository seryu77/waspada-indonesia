import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, CircleCheck, CircleX, Send } from 'lucide-react'
import type { Actor, Dispatch } from '../types'
import { clockWIB } from '../lib/format'

interface Props {
  dispatch: Dispatch
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
}

const ACTOR: Record<Actor, string> = { ai: 'AI', operator: 'Operator', system: 'Sistem' }

function useRemaining(deadline?: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const t = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(t)
  }, [deadline])
  return deadline ? Math.max(0, (Date.parse(deadline) - now) / 1000) : 0
}

export function DispatchTimeline({ dispatch, onConfirm, onCancel }: Props) {
  const remaining = useRemaining(dispatch.state === 'countdown' ? dispatch.deadline : undefined)
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null)
  const total = dispatch.countdown_s ?? 45
  const counting = dispatch.state === 'countdown'
  const secs = Math.ceil(remaining)
  const urgent = counting && secs <= 10

  const run = async (kind: 'confirm' | 'cancel') => {
    setBusy(kind)
    try {
      await (kind === 'confirm' ? onConfirm() : onCancel())
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="dispatch-h" className="border-t border-line px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="dispatch-h" className="sign text-[13px] text-muted-fg">
          Dispatch 112
        </h3>
        <span className="text-xs text-muted-fg">{dispatch.mode === 'simulate' ? 'Mode simulasi' : 'Webhook command center'}</span>
      </div>
      <p className="mt-1 text-sm text-dim">
        Ke <span className="font-semibold text-fg">{dispatch.agency}</span>
      </p>

      <AnimatePresence mode="wait" initial={false}>
        {counting ? (
          <motion.div key="cd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="mt-3">
            <div className="flex items-end justify-between">
              <span className="text-sm text-dim">Terkirim otomatis dalam</span>
              <motion.span
                className="font-display text-[44px] font-bold leading-none tabular"
                animate={{ color: urgent ? '#F2555A' : '#E9EBEE' }}
                transition={{ duration: 0.3 }}
                aria-live="off"
              >
                {remaining > 0 ? (
                  <>
                    {secs}
                    <span className="ml-1 text-lg font-semibold text-muted-fg">dtk</span>
                  </>
                ) : (
                  <span className="text-2xl">Mengirim</span>
                )}
              </motion.span>
            </div>
            <div
              className="relative mt-2 h-2 overflow-hidden bg-line"
              role="progressbar"
              aria-label="Sisa hitung mundur"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={secs}
            >
              <div className="ticks absolute inset-0 origin-left bg-sev-critical" style={{ transform: `scaleX(${remaining / total})` }} />
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('confirm')}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-alarm text-white transition-colors duration-150 hover:bg-alarm-hover disabled:opacity-60"
              >
                <Send size={16} aria-hidden />
                <span className="sign text-[15px]">Kirim sekarang</span>
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('cancel')}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-line-strong px-4 text-dim transition-colors duration-150 hover:border-fg hover:text-fg disabled:opacity-60"
              >
                <Ban size={16} aria-hidden />
                <span className="sign text-[15px]">Batalkan</span>
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-fg">
              Operator memegang keputusan akhir. Tanpa aksi, payload diteruskan ke command center. Sistem ini tidak pernah menelepon 112 secara langsung.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={dispatch.state}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="mt-3 flex items-center gap-2 border-l-2 py-1 pl-3"
            style={{ borderColor: dispatch.state === 'sent' ? '#3CCF7E' : '#5B626C' }}
            role="status"
          >
            {dispatch.state === 'sent' ? <CircleCheck size={18} className="text-accent" aria-hidden /> : <CircleX size={18} className="text-muted-fg" aria-hidden />}
            <span className="sign text-[15px]" style={{ color: dispatch.state === 'sent' ? '#3CCF7E' : '#C3C8CF' }}>
              {dispatch.state === 'sent' ? 'Terkirim' : dispatch.state === 'cancelled' ? 'Dibatalkan operator' : 'Gagal terkirim'}
            </span>
            {dispatch.state === 'sent' && dispatch.sent_at && <span className="ml-auto text-xs text-muted-fg tabular">{clockWIB(dispatch.sent_at)}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {dispatch.timeline.length > 0 && (
        <ol className="mt-4" aria-label="Timeline keputusan">
          <AnimatePresence initial={false}>
            {dispatch.timeline.map((t, idx) => (
              <motion.li
                key={`${t.at}-${t.action}-${idx}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-[76px_1fr] gap-3 border-t border-line py-2 text-[13px]"
              >
                <span className="text-muted-fg tabular">{clockWIB(t.at).replace(' WIB', '')}</span>
                <span>
                  <span className="sign mr-2 text-[12px] text-dim">{ACTOR[t.actor]}</span>
                  <span className="text-fg">{t.note}</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </section>
  )
}
