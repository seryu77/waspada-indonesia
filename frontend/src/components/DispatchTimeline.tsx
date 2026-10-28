import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, Bot, CircleCheck, CircleX, Send, Server, Siren, UserRound } from 'lucide-react'
import type { Actor, Dispatch } from '../types'
import { clockWIB } from '../lib/format'

interface Props {
  dispatch: Dispatch
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
}

const ACTOR: Record<Actor, { Icon: typeof Bot; label: string }> = {
  ai: { Icon: Bot, label: 'AI' },
  operator: { Icon: UserRound, label: 'Operator' },
  system: { Icon: Server, label: 'Sistem' },
}

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

  const run = async (kind: 'confirm' | 'cancel') => {
    setBusy(kind)
    try {
      await (kind === 'confirm' ? onConfirm() : onCancel())
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="dispatch-h" className="rounded-xl border border-white/10 bg-card/70 p-3">
      <div className="flex items-center gap-2">
        <Siren size={16} className="text-[#F87171]" aria-hidden />
        <h3 id="dispatch-h" className="font-mono text-sm font-semibold">
          Dispatch 112
        </h3>
        <span className="ml-auto rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted-fg">
          {dispatch.mode === 'simulate' ? 'mode simulasi' : 'webhook command center'}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-fg">
        Instansi tujuan: <span className="text-fg">{dispatch.agency}</span>
      </p>

      <AnimatePresence mode="wait" initial={false}>
        {counting ? (
          <motion.div key="cd" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="mt-3">
            <div className="flex items-end justify-between">
              <span className="text-xs text-muted-fg">Terkirim otomatis dalam</span>
              <span className="font-mono text-2xl font-semibold text-[#F87171] tabular" aria-live="off">
                {remaining > 0 ? `${Math.ceil(remaining)} dtk` : 'Mengirim...'}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Sisa hitung mundur" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.ceil(remaining)}>
              <div className="h-full origin-left rounded-full bg-danger" style={{ transform: `scaleX(${remaining / total})` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('confirm')}
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-[#DC2626] text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#B91C1C] disabled:opacity-60"
              >
                <Send size={16} aria-hidden />
                Kirim sekarang
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('cancel')}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 text-sm font-medium transition-colors duration-150 hover:bg-white/10 disabled:opacity-60"
              >
                <Ban size={16} aria-hidden />
                Batalkan
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-fg">
              Operator tetap memegang keputusan. Tanpa aksi, payload diteruskan ke command center. Kode ini tidak pernah menelepon 112 secara langsung.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={dispatch.state}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              dispatch.state === 'sent' ? 'bg-accent/10 text-accent' : 'bg-white/5 text-muted-fg'
            }`}
            role="status"
          >
            {dispatch.state === 'sent' ? <CircleCheck size={16} aria-hidden /> : <CircleX size={16} aria-hidden />}
            {dispatch.state === 'sent'
              ? `Terkirim${dispatch.sent_at ? ` pukul ${clockWIB(dispatch.sent_at)}` : ''}`
              : dispatch.state === 'cancelled'
                ? 'Dibatalkan operator'
                : 'Gagal terkirim, perlu tindak lanjut manual'}
          </motion.div>
        )}
      </AnimatePresence>

      {dispatch.timeline.length > 0 && (
        <ol className="mt-3 space-y-2 border-l border-white/10 pl-3" aria-label="Timeline keputusan">
          <AnimatePresence initial={false}>
            {dispatch.timeline.map((t, idx) => {
              const a = ACTOR[t.actor]
              return (
                <motion.li
                  key={`${t.at}-${t.action}-${idx}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                  className="relative text-xs"
                >
                  <span className="absolute -left-[19px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-bg ring-1 ring-white/20" aria-hidden>
                    <a.Icon size={9} />
                  </span>
                  <span className="font-mono text-[11px] text-muted-fg tabular">{clockWIB(t.at)}</span>
                  <span className="ml-2 font-medium">{a.label}</span>
                  <span className="block text-muted-fg">{t.note}</span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  )
}
