import { useEffect, useMemo, useState } from 'react'
import type { Hotspot, HotspotMeta } from '../types'
import { demoHotspots } from '../lib/hotspots'

export interface HotspotData {
  points: Hotspot[]
  /** Sedang mengambil data pertama setelah toggle dinyalakan */
  loading: boolean
  failed: boolean
}

/**
 * Titik panas satelit, hanya diambil saat heatmap dinyalakan. Selama aktif, data diambil ulang
 * setiap server mengabarkan versi baru lewat WebSocket (hotspots.meta).
 */
export function useHotspots(enabled: boolean, mode: HotspotMeta['mode'] | undefined, version: number | undefined, now: number): HotspotData {
  const [live, setLive] = useState<{ version: number | undefined; points: Hotspot[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const wantLive = enabled && mode === 'live'

  useEffect(() => {
    if (!wantLive) return
    const ctrl = new AbortController()
    fetch('/api/hotspots', { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ hotspots: Hotspot[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setLive({ version, points: d.hotspots })
        setFailed(false)
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setFailed(true)
      })
    return () => ctrl.abort()
  }, [wantLive, version])

  const demo = useMemo(() => (enabled && mode === 'demo' ? demoHotspots(now) : []), [enabled, mode, now])

  if (!enabled) return { points: [], loading: false, failed: false }
  if (mode === 'demo') return { points: demo, loading: false, failed: false }
  if (mode !== 'live') return { points: [], loading: mode === undefined, failed: false }
  return { points: live?.points ?? [], loading: live === null && !failed, failed }
}
