import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Info } from 'lucide-react'
import { ROUTES, SEVERITY, ZONE_ORDER, ZONES } from '../lib/hazards'

function LegendBody() {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Rute</p>
        <ul className="space-y-1.5">
          {(['blocked', 'danger'] as const).map((r) => (
            <li key={r} className="flex items-center gap-2">
              <svg width="28" height="8" aria-hidden>
                <line x1="1" y1="4" x2="27" y2="4" stroke={ROUTES[r].color} strokeWidth="3" strokeLinecap="round" strokeDasharray={ROUTES[r].dash ? '5 4' : undefined} />
              </svg>
              <span>
                {ROUTES[r].label}
                <span className="text-muted-fg">{r === 'blocked' ? ' (kuning putus-putus)' : ' (merah)'}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Zona</p>
        <ul className="space-y-1.5">
          {ZONE_ORDER.map((z) => (
            <li key={z} className="flex items-center gap-2">
              <span className="h-3 w-7 rounded-sm" style={{ background: `${ZONES[z].fill}55`, border: `1.5px ${ZONES[z].dash ? 'dashed' : 'solid'} ${ZONES[z].stroke}` }} aria-hidden />
              {ZONES[z].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Cincin penanda = severity</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: SEVERITY[s].color }} aria-hidden />
              {SEVERITY[s].label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Legend({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false)
  if (inline) {
    return (
      <div>
        <h3 className="mb-2 font-mono text-sm font-semibold">Legenda</h3>
        <LegendBody />
      </div>
    )
  }
  return (
    <div className="glass pointer-events-auto w-60 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="legend-body"
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-white/5"
      >
        <Info size={16} aria-hidden />
        Legenda rute dan zona
        <motion.span className="ml-auto" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden>
          <ChevronDown size={16} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="legend-body"
            key="legend"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <LegendBody />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
