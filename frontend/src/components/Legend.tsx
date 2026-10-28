import { ROUTES, SEVERITY, ZONE_ORDER, ZONES } from '../lib/hazards'
import { MAP_ENGINE } from '../map/engine'

/** Legenda ringkas untuk rail layer dan drawer mobile. */
export function Legend({ inline: _inline = true }: { inline?: boolean }) {
  return (
    <section aria-labelledby="legend-h" className="px-3 py-3 text-xs text-dim">
      <h3 id="legend-h" className="sign mb-2 text-[12px] text-muted-fg">
        Legenda
      </h3>
      <dl className="space-y-1.5">
        {(['blocked', 'danger'] as const).map((r) => (
          <div key={r} className="flex items-center gap-2">
            <dt className="shrink-0">
              <svg width="22" height="6" aria-hidden>
                <line x1="1" y1="3" x2="21" y2="3" stroke={ROUTES[r].color} strokeWidth="3" strokeDasharray={ROUTES[r].dash ? '5 3' : undefined} />
              </svg>
            </dt>
            <dd>
              {ROUTES[r].label}
              <span className="text-muted-fg">{r === 'blocked' ? ', kuning putus-putus' : ', merah'}</span>
            </dd>
          </div>
        ))}
        {ZONE_ORDER.map((z) => (
          <div key={z} className="flex items-center gap-2">
            <dt className="shrink-0">
              <span className="block h-2.5 w-[22px]" style={{ background: `${ZONES[z].fill}50`, border: `1.5px ${ZONES[z].dash ? 'dashed' : 'solid'} ${ZONES[z].stroke}` }} aria-hidden />
            </dt>
            <dd>{ZONES[z].label}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        <span className="text-muted-fg">Severity:</span>
        {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2" style={{ background: SEVERITY[s].color }} aria-hidden />
            {SEVERITY[s].label}
          </span>
        ))}
      </p>
      <p className="mt-3 text-muted-fg">Peta: {MAP_ENGINE}</p>
    </section>
  )
}
