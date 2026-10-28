import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { ImagePlus, LocateFixed, MapPin, Send, X } from 'lucide-react'
import type { HazardType, ReportInput } from '../types'
import { HAZARD_ORDER, HAZARDS } from '../lib/hazards'
import { INDONESIA_BOUNDS } from '../lib/bounds'
import { coord } from '../lib/format'

interface Props {
  picked: { lat: number; lng: number } | null
  setPicked: (p: { lat: number; lng: number } | null) => void
  onPickOnMap: () => void
  onClose: () => void
  onSubmit: (r: ReportInput) => Promise<void>
  hidden?: boolean
}

const inIndonesia = (lat: number, lng: number) =>
  lat <= INDONESIA_BOUNDS.north && lat >= INDONESIA_BOUNDS.south && lng >= INDONESIA_BOUNDS.west && lng <= INDONESIA_BOUNDS.east

export function ReportForm({ picked, setPicked, onPickOnMap, onClose, onSubmit, hidden = false }: Props) {
  const [type, setType] = useState<HazardType>('flood')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (hidden) return
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, hidden])

  const useMyLocation = () => {
    if (!navigator.geolocation) return setError('Browser tidak mendukung lokasi.')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        if (!inIndonesia(latitude, longitude)) return setError('Lokasi kamu di luar wilayah Indonesia. Pilih titik di peta.')
        setError(null)
        setPicked({ lat: latitude, lng: longitude })
      },
      () => setError('Izin lokasi ditolak. Pilih titik di peta.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!picked) return setError('Pilih lokasi kejadian terlebih dahulu.')
    if (description.trim().length < 10) return setError('Deskripsi minimal 10 karakter.')
    setError(null)
    setSending(true)
    try {
      await onSubmit({ type, description: description.trim(), lat: picked.lat, lng: picked.lng, photo })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <motion.div
        className="pointer-events-auto fixed inset-0 z-50 bg-black/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ display: hidden ? 'none' : undefined }}
        aria-hidden
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-h"
        style={{ display: hidden ? 'none' : undefined }}
        className="glass-strong scroll-thin pointer-events-auto fixed inset-x-3 bottom-3 top-auto z-50 max-h-[88vh] overflow-y-auto rounded-2xl p-4 sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="flex items-center justify-between">
            <h2 id="report-h" className="font-mono text-base font-semibold">
              Lapor kejadian
            </h2>
            <button type="button" onClick={onClose} aria-label="Tutup form laporan" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10">
              <X size={18} aria-hidden />
            </button>
          </div>
          <p className="-mt-2 text-xs text-muted-fg">Laporan diverifikasi AI sebelum tampil sebagai terkonfirmasi. Dalam kondisi darurat, langsung hubungi 112.</p>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Jenis kejadian</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {HAZARD_ORDER.map((h, idx) => {
                const { Icon, color, label } = HAZARDS[h]
                const active = type === h
                return (
                  <button
                    key={h}
                    ref={idx === 0 ? firstRef : undefined}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setType(h)}
                    className={`flex h-10 items-center gap-2 rounded-lg border px-2 text-left text-sm transition-colors duration-150 ${
                      active ? 'border-white/60 bg-white/10' : 'border-white/10 hover:bg-white/5'
                    }`}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: color }} aria-hidden>
                      <Icon size={13} color="#0F172A" strokeWidth={2.4} />
                    </span>
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="report-desc" className="mb-1.5 block text-sm font-medium">
              Deskripsi
            </label>
            <textarea
              id="report-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Contoh: air setinggi lutut menutup jalan di depan pasar"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg placeholder:text-muted-fg focus:border-white focus:outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Lokasi</span>
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
              {picked ? (
                <span className="flex items-center gap-2 font-mono text-xs tabular">
                  <MapPin size={14} aria-hidden /> {coord(picked.lat, picked.lng)}
                </span>
              ) : (
                <span className="text-muted-fg">Belum dipilih</span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={onPickOnMap} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm hover:bg-white/10">
                <MapPin size={16} aria-hidden /> Pilih di peta
              </button>
              <button type="button" onClick={useMyLocation} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm hover:bg-white/10">
                <LocateFixed size={16} aria-hidden /> Lokasi saya
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="report-photo" className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-white/25 px-3 text-sm text-muted-fg hover:bg-white/5">
              <ImagePlus size={16} aria-hidden />
              <span className="truncate">{photo ? photo.name : 'Tambah foto (opsional)'}</span>
            </label>
            <input id="report-photo" type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <p className="mt-1 text-[11px] text-muted-fg">Wajah dan plat nomor diblur otomatis sebelum disimpan.</p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-[#FCA5A5]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-on-accent transition-colors duration-150 hover:bg-[#16A34A] disabled:opacity-60"
          >
            <Send size={16} aria-hidden />
            {sending ? 'Mengirim...' : 'Kirim laporan'}
          </button>
        </form>
      </motion.div>
    </>
  )
}
