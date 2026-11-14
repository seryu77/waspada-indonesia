// Panel kendali rekam video demo (/rekam). Dibuka di jendela atau HP terpisah supaya tidak ikut terekam.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Clapperboard, ExternalLink, RotateCcw, Satellite, Siren } from 'lucide-react'
import type { HazardType, Incident, Snapshot } from './types'
import { HAZARDS } from './lib/hazards'
import { TONE_COLOR, workStatus } from './lib/operator'
import { timeAgo } from './lib/format'

interface DemoState {
  demo: boolean
  recording: boolean
  /** Daftar jenis dipisah koma, kosong = semua */
  focus: string
}

interface Scenario {
  name: string
  title: string
  expect: string
  color: string
}

/** Skenario per jenis bahaya. Hasilnya tetap (tidak acak), sama dengan backend app/demo.py */
const GROUPS: { type: HazardType; scenarios: Scenario[] }[] = [
  {
    type: 'fire',
    scenarios: [
      {
        name: 'fire_auto',
        title: 'Kebakaran gudang, Penjaringan (CCTV + YOLO)',
        expect: 'Diverifikasi AI 2,5 detik, terkonfirmasi 93% (di atas ambang 87%), lalu hitung mundur 45 detik dan terkirim otomatis ke 112 kalau operator tidak bertindak.',
        color: '#F2555A',
      },
      {
        name: 'fire_citizen',
        title: 'Laporan warga: kebakaran rumah, Bandung',
        expect: 'Terkonfirmasi 88% (di atas ambang), tetapi laporan warga wajib divalidasi. Masuk tab Validasi dan tab Laporan warga.',
        color: '#EAB308',
      },
      {
        name: 'fire_false',
        title: 'Asap gerobak sate, Malioboro (CCTV + YOLO)',
        expect: 'AI menilai false alarm 86%, langsung disembunyikan dari peta, tercatat di Riwayat dan Log aktivitas.',
        color: '#929AA4',
      },
    ],
  },
  {
    type: 'accident',
    scenarios: [
      {
        name: 'accident_auto',
        title: 'Bus terguling, Tol Semarang-Solo (CCTV + YOLO)',
        expect: 'Terkonfirmasi 91%, severity kritis, langsung hitung mundur 45 detik ke PJR + Ambulans 119.',
        color: '#F2555A',
      },
      {
        name: 'accident_review',
        title: 'Tabrakan di persimpangan, Surabaya (CCTV + YOLO)',
        expect: 'Terkonfirmasi 78%, di bawah ambang 87%. Masuk tab Validasi tanpa timer, menunggu Validasi & kirim atau Tolak.',
        color: '#EAB308',
      },
    ],
  },
  {
    type: 'earthquake',
    scenarios: [
      {
        name: 'quake_auto',
        title: 'Gempa M6,4 Cianjur (data BMKG)',
        expect: 'Sumber resmi, tidak lewat AI. Aturan gempa M6+ langsung hitung mundur 45 detik ke BPBD + Basarnas.',
        color: '#F2555A',
      },
      {
        name: 'quake_watch',
        title: 'Gempa M4,8 Bengkulu (data BMKG)',
        expect: 'Di bawah M6: tampil di peta sebagai info, tidak masuk alur dispatch 112.',
        color: '#929AA4',
      },
    ],
  },
]

const FOCUS_DEFAULT: HazardType[] = ['fire', 'earthquake', 'accident']
const ALL_TYPES = Object.keys(HAZARDS) as HazardType[]

const dash = (id: string) => `/operator/dashboard?incident=${encodeURIComponent(id)}`

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="sign text-[14px] text-fg">{title}</h2>
        {aside}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
      {children} <ExternalLink size={12} aria-hidden />
    </a>
  )
}

function SatList({ list, empty }: { list: Incident[]; empty: string }) {
  if (list.length === 0) return <p className="text-[13px] text-muted-fg">{empty}</p>
  return (
    <ul className="divide-y divide-line">
      {list.map((i) => {
        const outside = i.verification?.reasoning.includes('di luar Indonesia')
        return (
          <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
            <span className="min-w-0">
              <span className="block text-[13px] text-fg">
                {i.title} <span className="text-muted-fg tabular">({i.lat.toFixed(2)}, {i.lng.toFixed(2)})</span>
              </span>
              <span className="block text-[11px] text-muted-fg">
                {i.verification ? `${i.verification.verdict === 'confirmed' ? 'Terkonfirmasi' : 'Belum pasti'} ${Math.round(i.verification.confidence * 100)}%` : 'Belum diverifikasi'}
                {outside && <span className="text-sev-critical">, di luar Indonesia: jangan direkam</span>}
              </span>
            </span>
            <OpenLink href={dash(i.id)}>Buka</OpenLink>
          </li>
        )
      })}
    </ul>
  )
}

export default function DemoControl() {
  const [state, setState] = useState<DemoState | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [triggered, setTriggered] = useState<{ id: string; scenario: string; at: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([fetch('/api/demo/state'), fetch('/api/snapshot?role=operator')])
      if (s.ok) setState((await s.json()) as DemoState)
      if (d.ok) setSnap((await d.json()) as Snapshot)
      setError(s.ok ? null : 'Backend menolak permintaan. Pastikan DEMO_MODE aktif.')
    } catch {
      setError('Backend tidak terjangkau. Pastikan server port 8000 jalan.')
    }
  }, [])

  useEffect(() => {
    const first = window.setTimeout(refresh, 0)
    const t = window.setInterval(refresh, 4000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(t)
    }
  }, [refresh])

  const post = async (key: string, url: string, body?: unknown) => {
    setBusy(key)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as Record<string, unknown>
    } catch {
      setError('Aksi gagal. Cek apakah backend port 8000 jalan.')
      return null
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const focus = (state?.focus ?? '').split(',').filter(Boolean) as HazardType[]
  const setFocus = (types: HazardType[]) => post('focus', '/api/demo/focus', { types })
  const toggleType = (t: HazardType) => setFocus(focus.includes(t) ? focus.filter((x) => x !== t) : [...focus, t])
  const toggleRecording = () => post('rec', '/api/demo/recording', { enabled: !state?.recording })
  const reset = async () => {
    if (!window.confirm('Reset demo? Kejadian simulasi dihapus, data contoh dimuat ulang, aturan otomasi kembali ke default.')) return
    if (await post('reset', '/api/demo/reset')) setTriggered([])
  }
  const trigger = async (name: string) => {
    const inc = await post(name, `/api/demo/scenario/${name}`)
    if (inc?.id) setTriggered((t) => [{ id: String(inc.id), scenario: name, at: new Date().toISOString() }, ...t].slice(0, 8))
  }

  const incidents = snap?.incidents ?? []
  const byId = new Map(incidents.map((i) => [i.id, i]))
  const sats = incidents.filter((i) => i.satellite && i.status === 'active')
  const satReview = sats.filter((i) => i.dispatch?.state === 'review')
  const satNews = sats.filter((i) => i.verification?.verdict === 'confirmed')
  const satFixed = sats.filter((i) => (i.satellite?.persistent_points ?? 0) > 0)
  const recording = !!state?.recording

  return (
    <main className="min-h-dvh bg-bg px-4 py-5 text-fg">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-[26px] font-semibold leading-none">
              <Clapperboard size={22} aria-hidden /> Panel rekam demo
            </h1>
            <p className="mt-1 text-[13px] text-muted-fg">Buka halaman ini di jendela lain atau di HP, supaya tombolnya tidak ikut terekam.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <OpenLink href="/">Peta publik</OpenLink>
            <OpenLink href="/operator">Peta operator</OpenLink>
            <OpenLink href="/operator/dashboard">Dashboard</OpenLink>
          </div>
        </header>

        {error && <p className="rounded-lg border border-sev-critical/60 px-4 py-2 text-[13px] text-sev-critical">{error}</p>}

        <Card
          title="1. Mode rekam"
          aside={
            <span className="sign text-[12px]" style={{ color: recording ? '#3CCF7E' : '#929AA4' }}>
              {recording ? 'Aktif' : 'Mati'}
            </span>
          }
        >
          <p className="text-[13px] leading-relaxed text-dim">
            Saat aktif: simulator berhenti membuat kejadian acak, kejadian simulasi tidak ditutup otomatis, dan data live (satelit, BMKG, PetaBencana,
            MAGMA) dibekukan supaya isi dan id kejadian tidak berubah di tengah rekaman.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!state || busy !== null}
              onClick={toggleRecording}
              className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${recording ? 'border border-line-strong text-fg hover:bg-raised' : 'bg-accent text-on-accent hover:brightness-110'}`}
            >
              {recording ? 'Matikan mode rekam' : 'Nyalakan mode rekam'}
            </button>
            <button
              type="button"
              disabled={!state || busy !== null}
              onClick={reset}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong px-4 text-sm font-semibold text-fg transition-colors hover:bg-raised disabled:opacity-50"
            >
              <RotateCcw size={15} aria-hidden /> Reset demo
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-fg">
            Reset: kejadian simulasi dihapus, data contoh dimuat ulang (Palindra kembali ke Validasi, Cipularang hitung mundur lagi), aturan otomasi kembali ke default.
          </p>
        </Card>

        <Card title="2. Fokus jenis kejadian">
          <p className="text-[13px] leading-relaxed text-dim">
            Selama mode rekam, hanya jenis yang dicentang yang tampil di peta dan dashboard. Kejadian lain tetap ada di server, hanya disembunyikan.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ALL_TYPES.map((t) => {
              const on = focus.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  disabled={!state || busy !== null}
                  onClick={() => toggleType(t)}
                  className="h-9 rounded-lg border px-3 text-[13px] font-semibold transition-colors disabled:opacity-50"
                  style={{ borderColor: on ? HAZARDS[t].color : 'rgb(255 255 255 / 0.18)', color: on ? HAZARDS[t].color : '#929AA4' }}
                >
                  {HAZARDS[t].label}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
            <button type="button" disabled={busy !== null} onClick={() => setFocus(FOCUS_DEFAULT)} className="text-accent hover:underline disabled:opacity-50">
              Kebakaran, gempa, kecelakaan saja
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setFocus([])} className="text-muted-fg hover:underline disabled:opacity-50">
              Tampilkan semua
            </button>
          </div>
          {!recording && focus.length > 0 && <p className="mt-2 text-[12px] text-sev-medium">Fokus baru berlaku setelah mode rekam dinyalakan.</p>}
        </Card>

        <Card title="3. Picu skenario">
          <div className="flex flex-col gap-5">
            {GROUPS.map((g) => (
              <div key={g.type}>
                <h3 className="sign mb-2 text-[13px]" style={{ color: HAZARDS[g.type].color }}>
                  {HAZARDS[g.type].label}
                </h3>
                <ul className="flex flex-col gap-3">
                  {g.scenarios.map((s) => (
                    <li key={s.name} className="flex flex-wrap items-start justify-between gap-3 border-l-2 pl-3" style={{ borderColor: s.color }}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-fg">{s.title}</span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-fg">{s.expect}</span>
                      </span>
                      <button
                        type="button"
                        disabled={busy !== null || !state?.demo}
                        onClick={() => trigger(s.name)}
                        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm font-semibold text-fg transition-colors hover:bg-raised disabled:opacity-50"
                      >
                        <Siren size={14} style={{ color: s.color }} aria-hidden /> Picu
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {triggered.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="sign mb-1 text-[12px] text-muted-fg">Baru dipicu</h3>
              <ul className="divide-y divide-line">
                {triggered.map((t) => {
                  const inc = byId.get(t.id)
                  const st = inc ? workStatus(inc) : { label: 'Menunggu', tone: 'muted' as const }
                  return (
                    <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
                      <span>
                        {inc?.title ?? t.scenario} <span className="text-muted-fg">({timeAgo(t.at)})</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="sign text-[12px]" style={{ color: TONE_COLOR[st.tone] }}>
                          {st.label}
                        </span>
                        <OpenLink href={dash(t.id)}>Buka</OpenLink>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </Card>

        <Card title="4. Indikasi kebakaran dari satelit" aside={<Satellite size={16} className="text-muted-fg" aria-hidden />}>
          <h3 className="sign mt-1 text-[12px] text-sev-medium">Butuh validasi (kritis)</h3>
          <SatList list={satReview} empty="Belum ada indikasi satelit di antrean validasi." />
          <h3 className="sign mt-4 text-[12px] text-accent">Terkonfirmasi lewat berita</h3>
          <SatList list={satNews} empty="Belum ada indikasi yang didukung berita saat ini." />
          <h3 className="sign mt-4 text-[12px] text-muted-fg">Sumber panas tetap (flare atau industri)</h3>
          <SatList list={satFixed} empty="Tidak ada indikasi yang ditandai sumber panas tetap." />
        </Card>
      </div>
    </main>
  )
}
