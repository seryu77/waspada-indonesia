import { useCallback, useEffect, useRef, useState } from 'react'
import type { Camera, Connection, Incident, ReportInput, Severity, Snapshot } from '../types'
import { SIM_TEMPLATES, seedSnapshot } from '../lib/seed'
import { heuristicVerify, resolveDispatch, shouldAutoDispatch, simulateIncident, startCountdown } from '../lib/localEngine'

const STALE_AFTER_MS = 45_000
const RECONNECT_MAX_MS = 15_000

type WsMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'incident.upsert'; data: Incident }
  | { type: 'camera.update'; data: Camera }
  | { type: 'heartbeat'; data: { server_time: string } }

export interface LiveData {
  snapshot: Snapshot
  connection: Connection
  lastUpdate: number | null
  offline: boolean
  newCritical: Incident[]
  dismissToast: (id: string) => void
  confirmDispatch: (id: string) => Promise<void>
  cancelDispatch: (id: string) => Promise<void>
  submitReport: (r: ReportInput) => Promise<Incident>
  triggerDemo: () => Promise<void>
}

function upsert(list: Incident[], inc: Incident): Incident[] {
  const i = list.findIndex((x) => x.id === inc.id)
  if (i === -1) return [inc, ...list]
  const next = list.slice()
  next[i] = inc
  return next
}

// Putar template secara acak tanpa mengulang lokasi sampai semua terpakai
let bag: number[] = []
function nextTemplate() {
  if (bag.length === 0) bag = [...SIM_TEMPLATES.keys()].sort(() => Math.random() - 0.5)
  return SIM_TEMPLATES[bag.pop()!]
}

export function useLiveData(): LiveData {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => seedSnapshot())
  const [connection, setConnection] = useState<Connection>('connecting')
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [newCritical, setNewCritical] = useState<Incident[]>([])
  const seenIds = useRef<Set<string>>(new Set(snapshot.incidents.map((i) => i.id)))
  const lastMsgAt = useRef<number>(0)
  const connectionRef = useRef<Connection>('connecting')
  connectionRef.current = connection
  const offline = connection === 'offline'

  const notifyIfNewCritical = useCallback((inc: Incident) => {
    const fresh = !seenIds.current.has(inc.id)
    seenIds.current.add(inc.id)
    const sev = inc.verification?.severity ?? inc.severity
    if (fresh && sev === 'critical') setNewCritical((t) => [inc, ...t].slice(0, 3))
  }, [])

  const applyIncident = useCallback(
    (inc: Incident) => {
      notifyIfNewCritical(inc)
      setSnapshot((s) => ({ ...s, incidents: upsert(s.incidents, inc) }))
    },
    [notifyIfNewCritical],
  )

  // WebSocket ke backend, reconnect dengan backoff
  useEffect(() => {
    let ws: WebSocket | null = null
    let retry = 0
    let timer: number | undefined
    let disposed = false

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        retry = 0
      }
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as WsMessage
        lastMsgAt.current = Date.now()
        setLastUpdate(Date.now())
        setConnection('live')
        if (msg.type === 'snapshot') {
          msg.data.incidents.forEach((i) => seenIds.current.add(i.id))
          setSnapshot(msg.data)
        } else if (msg.type === 'incident.upsert') {
          applyIncident(msg.data)
        } else if (msg.type === 'camera.update') {
          setSnapshot((s) => ({ ...s, cameras: s.cameras.map((c) => (c.id === msg.data.id ? msg.data : c)) }))
        }
      }
      ws.onclose = () => {
        if (disposed) return
        setConnection('offline')
        retry += 1
        timer = window.setTimeout(connect, Math.min(RECONNECT_MAX_MS, 1000 * 2 ** retry))
      }
      ws.onerror = () => ws?.close()
    }
    connect()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      if (ws?.readyState === WebSocket.CONNECTING) {
        // Tutup setelah tersambung supaya browser tidak mencatat error (StrictMode dev)
        ws.onopen = () => ws?.close()
        ws.onmessage = null
      } else {
        ws?.close()
      }
    }
  }, [applyIncident])

  // Tandai basi kalau tidak ada pesan dalam waktu lama
  useEffect(() => {
    const t = window.setInterval(() => {
      if (connectionRef.current === 'live' && Date.now() - lastMsgAt.current > STALE_AFTER_MS) setConnection('stale')
    }, 5000)
    return () => window.clearInterval(t)
  }, [])

  // Simulator lokal: buat kejadian lalu verifikasi heuristik setelah 2,5 detik
  const spawnLocal = useCallback(
    (forced?: Severity, cctvOnly = false) => {
      const pool = cctvOnly ? SIM_TEMPLATES.filter((t) => t.source.kind === 'cctv') : null
      const tpl = pool ? pool[Math.floor(Math.random() * pool.length)] : nextTemplate()
      const inc = simulateIncident(tpl, forced)
      applyIncident(inc)
      setLastUpdate(Date.now())
      return window.setTimeout(() => {
        const v = heuristicVerify(inc)
        const done: Incident = { ...inc, verifying: false, verification: v, updated_at: new Date().toISOString() }
        if (shouldAutoDispatch(v)) done.dispatch = startCountdown(v)
        applyIncident(done)
      }, 2500)
    },
    [applyIncident],
  )

  // Mode offline: simulator lokal supaya demo tetap hidup
  useEffect(() => {
    if (!offline) return
    let timer: number
    const verifyTimers: number[] = []
    const tick = () => {
      verifyTimers.push(spawnLocal())
      timer = window.setTimeout(tick, 20_000 + Math.random() * 10_000)
    }
    timer = window.setTimeout(tick, 6000)
    return () => {
      window.clearTimeout(timer)
      verifyTimers.forEach((t) => window.clearTimeout(t))
    }
  }, [offline, spawnLocal])

  const triggerDemo = useCallback(async () => {
    if (connectionRef.current !== 'offline') {
      try {
        const res = await fetch('/api/demo/trigger', { method: 'POST' })
        if (res.ok) return
      } catch {
        /* jatuh ke mode lokal */
      }
    }
    spawnLocal('critical', true)
  }, [spawnLocal])

  // Mode offline: hitung mundur yang habis otomatis terkirim
  useEffect(() => {
    if (!offline) return
    const t = window.setInterval(() => {
      setSnapshot((s) => {
        let changed = false
        const incidents = s.incidents.map((i) => {
          if (i.dispatch?.state === 'countdown' && i.dispatch.deadline && Date.parse(i.dispatch.deadline) <= Date.now()) {
            changed = true
            return { ...i, dispatch: resolveDispatch(i.dispatch, 'auto') }
          }
          return i
        })
        return changed ? { ...s, incidents } : s
      })
    }, 500)
    return () => window.clearInterval(t)
  }, [offline])

  const localResolve = useCallback((id: string, how: 'confirmed' | 'cancelled') => {
    setSnapshot((s) => ({
      ...s,
      incidents: s.incidents.map((i) => (i.id === id && i.dispatch?.state === 'countdown' ? { ...i, dispatch: resolveDispatch(i.dispatch, how) } : i)),
    }))
  }, [])

  const dispatchAction = useCallback(
    async (id: string, action: 'confirm' | 'cancel') => {
      if (connectionRef.current !== 'offline') {
        try {
          const res = await fetch(`/api/incidents/${encodeURIComponent(id)}/dispatch/${action}`, { method: 'POST' })
          if (res.ok) {
            applyIncident((await res.json()) as Incident)
            return
          }
        } catch {
          /* jatuh ke mode lokal */
        }
      }
      localResolve(id, action === 'confirm' ? 'confirmed' : 'cancelled')
    },
    [applyIncident, localResolve],
  )

  const submitReport = useCallback(
    async (r: ReportInput): Promise<Incident> => {
      if (connectionRef.current !== 'offline') {
        try {
          const fd = new FormData()
          fd.set('type', r.type)
          fd.set('description', r.description)
          fd.set('lat', String(r.lat))
          fd.set('lng', String(r.lng))
          if (r.photo) fd.set('photo', r.photo)
          const res = await fetch('/api/reports', { method: 'POST', body: fd })
          if (res.ok) {
            const inc = (await res.json()) as Incident
            applyIncident(inc)
            return inc
          }
        } catch {
          /* jatuh ke mode lokal */
        }
      }
      const now = new Date().toISOString()
      const inc: Incident = {
        id: `rep-${Date.now().toString(36)}`,
        type: r.type,
        title: 'Laporan warga',
        description: r.description,
        lat: r.lat,
        lng: r.lng,
        address: `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`,
        severity: 'medium',
        status: 'active',
        source: { id: 'citizen', label: 'Laporan warga (lokal)', kind: 'citizen' },
        reported_at: now,
        updated_at: now,
        verifying: true,
      }
      applyIncident(inc)
      window.setTimeout(() => applyIncident({ ...inc, verifying: false, verification: heuristicVerify(inc) }), 2000)
      return inc
    },
    [applyIncident],
  )

  return {
    snapshot,
    connection,
    lastUpdate,
    offline,
    newCritical,
    dismissToast: (id) => setNewCritical((t) => t.filter((x) => x.id !== id)),
    confirmDispatch: (id) => dispatchAction(id, 'confirm'),
    cancelDispatch: (id) => dispatchAction(id, 'cancel'),
    submitReport,
    triggerDemo,
  }
}
