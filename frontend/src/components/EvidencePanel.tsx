import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { CircleMinus, CirclePlus, Info, Pause, Play, RefreshCw, Video } from 'lucide-react'
import type { Evidence, Incident, Signal, Snapshot } from '../types'
import { HAZARDS, SEVERITY } from '../lib/hazards'
import { aqiLevel, compass, fetchEvidence, signals } from '../lib/evidence'
import { clockWIB, timeAgo } from '../lib/format'
import { CameraPlayer } from './CameraPlayer'

interface Props {
  incident: Incident
  snapshot: Snapshot
  offline: boolean
  onSelect?: (id: string) => void
}

const fmt = (x: number | undefined, digits = 0) => (x === undefined || x === null ? '-' : x.toFixed(digits).replace('.', ','))

/** "2026-10-30T14:30" (waktu lokal WIB dari Open-Meteo) -> "14.30 WIB" */
const localClock = (t: string) => `${t.slice(11, 16).replace(':', '.')} WIB`

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-line px-4 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id={id} className="sign text-[13px] text-muted-fg">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Tile({ label, value, unit, sub, color }: { label: string; value: string; unit?: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-raised px-3 py-2">
      <p className="text-[11px] text-muted-fg">{label}</p>
      <p className="font-display text-[20px] font-semibold leading-tight tabular" style={{ color }}>
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-normal text-muted-fg">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] leading-snug text-dim">{sub}</p>}
    </div>
  )
}

const SIGNAL_STYLE: Record<Signal['effect'], { Icon: typeof Info; color: string; label: string }> = {
  support: { Icon: CirclePlus, color: '#3CCF7E', label: 'Mendukung' },
  against: { Icon: CircleMinus, color: '#EAB308', label: 'Melemahkan' },
  info: { Icon: Info, color: '#929AA4', label: 'Info' },
}

function Signals({ list }: { list: Signal[] }) {
  if (list.length === 0) return <p className="text-sm text-muted-fg">Belum ada indikator yang bisa dihitung.</p>
  const order = { support: 0, against: 1, info: 2 }
  return (
    <ul className="space-y-1.5">
      {[...list]
        .sort((a, b) => order[a.effect] - order[b.effect])
        .map((s) => {
          const st = SIGNAL_STYLE[s.effect]
          return (
            <li key={s.label} className="flex items-start gap-2 text-[13px] leading-snug">
              <st.Icon size={15} className="mt-px shrink-0" style={{ color: st.color }} aria-label={st.label} />
              <span className="text-fg">{s.label}</span>
            </li>
          )
        })}
    </ul>
  )
}

/** Frame saat deteksi diputar berurutan seperti klip pendek. */
function FrameClip({ frames }: { frames: string[] }) {
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = window.setInterval(() => setIdx((i) => (i + 1) % frames.length), 900)
    return () => window.clearInterval(t)
  }, [playing, frames.length])
  const shown = frames.slice(0, 4)
  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <img src={shown[idx % shown.length]} alt={`Frame bukti ${(idx % shown.length) + 1} dari ${shown.length}`} className="h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="grid h-8 w-8 place-items-center rounded text-fg hover:bg-white/10"
            aria-label={playing ? 'Jeda rekaman' : 'Putar rekaman'}
          >
            {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          </button>
          <span className="text-[11px] text-dim tabular">
            Frame {(idx % shown.length) + 1}/{shown.length}
          </span>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        {shown.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => {
              setIdx(i)
              setPlaying(false)
            }}
            aria-label={`Lihat frame ${i + 1}`}
            className={`overflow-hidden rounded ${i === idx % shown.length ? 'ring-2 ring-fg' : 'opacity-70 hover:opacity-100'}`}
          >
            <img src={src} alt="" className="aspect-video w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  )
}

export function EvidencePanel({ incident, snapshot, offline, onSelect }: Props) {
  const [ev, setEv] = useState<Evidence | null>(null)
  const [loading, setLoading] = useState(true)
  // Ref supaya update WebSocket (snapshot/incident baru) tidak memicu fetch ulang terus-menerus
  const latest = useRef({ incident, snapshot })
  useEffect(() => {
    latest.current = { incident, snapshot }
  })

  const load = useCallback(async () => {
    try {
      setEv(await fetchEvidence(latest.current.incident, latest.current.snapshot, offline))
    } finally {
      setLoading(false)
    }
  }, [offline])

  // Panel detail di-mount ulang per kejadian (key di IncidentPanel), jadi cukup ambil saat mount
  useEffect(() => {
    void load()
  }, [load])

  // Frame bisa bertambah setelah evidence diambil (misal laporan warga baru selesai diunggah)
  const frames = incident.evidence?.length ? incident.evidence : (ev?.frames ?? [])
  const w = ev?.conditions.weather
  const a = ev?.conditions.air
  const aqi = a?.us_aqi !== undefined ? aqiLevel(a.us_aqi) : null

  return (
    <div aria-busy={loading}>
      <div className="flex items-center justify-between border-t border-line bg-raised/40 px-4 py-2.5">
        <h3 className="sign text-[14px]">Bukti pendukung</h3>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs text-dim transition-colors hover:bg-raised hover:text-fg disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden /> Perbarui
        </button>
      </div>

      {!ev ? (
        <div className="space-y-2 px-4 py-4" role="status">
          <p className="text-sm text-muted-fg">Mengumpulkan data lokasi, cuaca, dan kamera...</p>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <motion.div
                key={i}
                className="h-[58px] rounded-lg bg-raised"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          <Section id="sig-h" title="Indikator otomatis">
            <Signals list={signals(incident, ev)} />
            <p className="mt-2 text-[11px] text-muted-fg">Dihitung dari data di bawah sebagai bantuan baca. Keputusan tetap di tangan operator.</p>
          </Section>

          <Section
            id="cond-h"
            title="Kondisi lokasi"
            aside={
              <span className="text-[11px] text-muted-fg">
                {ev.conditions.provider}
                {w ? `, ${localClock(w.observed_at)}` : ''}
                {ev.local ? ' (langsung dari browser)' : ''}
              </span>
            }
          >
            {w || a ? (
              <>
                {w && (
                  <p className="mb-2 text-sm text-dim">
                    <span className="font-semibold capitalize text-fg">{w.description}</span>, {w.is_day ? 'siang' : 'malam'}, awan {fmt(w.cloud_cover_pct)}%
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {w && (
                    <>
                      <Tile label="Suhu udara" value={fmt(w.temperature_c, 1)} unit="°C" sub={`Terasa ${fmt(w.apparent_c, 1)} °C`} />
                      <Tile label="Kelembapan" value={fmt(w.humidity_pct)} unit="%" sub={(w.humidity_pct ?? 100) <= 50 ? 'Kering' : (w.humidity_pct ?? 0) >= 85 ? 'Sangat lembap' : 'Normal'} />
                      <Tile
                        label="Angin"
                        value={fmt(w.wind_speed_kmh, 1)}
                        unit="km/j"
                        sub={`Hembusan ${fmt(w.wind_gust_kmh)} km/j${w.wind_direction_deg !== undefined ? `, dari ${compass(w.wind_direction_deg)}` : ''}`}
                        color={(w.wind_gust_kmh ?? 0) >= 50 ? '#F97316' : undefined}
                      />
                      <Tile label="Hujan" value={fmt(w.precipitation_mm, 1)} unit="mm" sub={`24 jam terakhir ${fmt(w.rain_24h_mm, 1)} mm`} color={(w.rain_24h_mm ?? 0) >= 50 ? '#38BDF8' : undefined} />
                    </>
                  )}
                  {a?.us_aqi !== undefined && aqi && (
                    <Tile label="Kualitas udara (US AQI)" value={fmt(a.us_aqi)} sub={aqi.label} color={aqi.color} />
                  )}
                  {a?.pm2_5 !== undefined && <Tile label="PM2.5" value={fmt(a.pm2_5, 1)} unit="µg/m³" sub={`PM10 ${fmt(a.pm10, 1)} µg/m³`} />}
                  {w?.elevation_m !== undefined && (
                    <Tile label="Ketinggian" value={fmt(w.elevation_m)} unit="mdpl" sub={(w.elevation_m ?? 0) <= 10 ? 'Dataran rendah' : (w.elevation_m ?? 0) >= 200 ? 'Perbukitan' : 'Dataran'} />
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-fg">Data cuaca tidak bisa diambil saat ini. Coba Perbarui.</p>
            )}
          </Section>

          <Section
            id="cam-h"
            title="CCTV"
            aside={
              ev.camera && (
                <span className="text-[11px] text-muted-fg">
                  {ev.camera.detected_by ? 'Kamera pendeteksi' : `Kamera terdekat, ${fmt(ev.camera.distance_km, 1)} km`}
                </span>
              )
            }
          >
            {ev.camera ? (
              <>
                <p className="mb-2 flex items-center gap-2 text-[13px] text-fg">
                  <Video size={14} className="text-muted-fg" aria-hidden />
                  {ev.camera.name}, {ev.camera.city}
                  <span className="ml-auto text-[11px] text-muted-fg tabular">{ev.camera.detections_today} deteksi hari ini</span>
                </p>
                <CameraPlayer key={ev.camera.id} camera={ev.camera} />
              </>
            ) : (
              <p className="text-sm text-muted-fg">Tidak ada kamera dalam radius 5 km dari lokasi.</p>
            )}
            <h4 className="sign mb-1.5 mt-4 text-[12px] text-muted-fg">
              Rekaman saat deteksi <span className="normal-case tracking-normal">(wajah dan plat diblur)</span>
            </h4>
            {frames.length > 0 ? (
              <FrameClip frames={frames} />
            ) : (
              <p className="text-sm text-muted-fg">
                {incident.source.kind === 'cctv' || incident.source.kind === 'simulator'
                  ? 'Belum ada frame tersimpan untuk kejadian ini (data demo atau pipeline CCTV belum aktif).'
                  : 'Kejadian ini tidak berasal dari kamera.'}
              </p>
            )}
            <p className="mt-2 text-[13px] leading-relaxed text-dim">
              <span className="text-muted-fg">Catatan deteksi: </span>
              {ev.detection.description}
            </p>
          </Section>

          <Section id="near-h" title={`Kejadian sekitar (${ev.nearby_radius_km} km)`} aside={<span className="text-[11px] text-muted-fg tabular">{ev.nearby.length} ditemukan</span>}>
            {ev.nearby.length > 0 ? (
              <ul className="divide-y divide-line">
                {ev.nearby.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(n.id)}
                      className="grid w-full grid-cols-[52px_1fr] gap-2 py-2 text-left transition-colors hover:bg-raised/60"
                    >
                      <span className="text-[13px] font-semibold text-fg tabular">{fmt(n.distance_km, 1)} km</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-fg">{n.title}</span>
                        <span className="block truncate text-[11px] text-muted-fg">
                          <span style={{ color: HAZARDS[n.type].color }}>{HAZARDS[n.type].label}</span>
                          {', '}
                          <span style={{ color: SEVERITY[n.severity].color }}>{SEVERITY[n.severity].label.toLowerCase()}</span>, {n.source_label}, {timeAgo(n.reported_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-fg">Tidak ada kejadian atau laporan aktif lain di sekitar lokasi.</p>
            )}
            <p className="mt-2 text-[11px] text-muted-fg">Diambil {clockWIB(ev.conditions.fetched_at)}</p>
          </Section>
        </>
      )}
    </div>
  )
}
