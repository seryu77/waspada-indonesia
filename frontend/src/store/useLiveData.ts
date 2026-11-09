import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutomationRules, Camera, Connection, Incident, MyReport, NoteKind, ReportInput, Resolution, Severity, Snapshot, SnapshotMeta } from '../types'
import { SIM_TEMPLATES, seedSnapshot } from '../lib/seed'
import { getLocalRules, heuristicVerify, manualDispatch, resolveDispatch, routeDispatch, setLocalRules, simulateIncident } from '../lib/localEngine'

const isPending = (i: Incident) => i.dispatch?.state === 'countdown' || i.dispatch?.state === 'review'

const STALE_AFTER_MS = 45_000
const RECONNECT_MAX_MS = 15_000

type WsMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'incident.upsert'; data: Incident }
  | { type: 'camera.update'; data: Camera }
  | { type: 'meta.update'; data: SnapshotMeta }
  | { type: 'heartbeat'; data: { server_time: string } }

export type CloseReason = Exclude<Resolution, 'expired'>

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
  /** Aturan otomasi yang berlaku (dari server, atau lokal saat offline) */
  rules: AutomationRules
  updateRules: (patch: Partial<AutomationRules>) => Promise<void>
  resolveIncident: (id: string, reason: CloseReason, note?: string) => Promise<void>
  addNote: (id: string, text: string, kind?: Exclude<NoteKind, 'reply'>) => Promise<void>
  manualDispatch: (id: string) => Promise<void>
  /** Laporan warga yang dikirim dari browser ini */
  myReports: MyReport[]
  /** Pelapor membalas operator */
  replyReport: (id: string, text: string) => Promise<void>
}

const MY_REPORTS_KEY = 'waspada.myReports'
function loadMyReports(): MyReport[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MY_REPORTS_KEY) ?? '[]') as MyReport[]
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === 'string' && typeof r.token === 'string') : []
  } catch {
    return []
  }
}

/** POST/PUT JSON ke server. Lempar error berisi pesan server kalau gagal (4xx). null kalau server tak terjangkau. */
async function send<T>(url: string, body: unknown, method = 'POST'): Promise<T | null> {
  let res: Response
  try {
    res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return null
  }
  if (res.ok) return (await res.json()) as T
  if (res.status >= 500 || res.status === 404) return null
  const err = (await res.json().catch(() => null)) as { detail?: unknown } | null
  throw new Error(typeof err?.detail === 'string' ? err.detail : `Permintaan ditolak server (${res.status})`)
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

/** operator: halaman operator menerima catatan internal lewat /ws?role=operator */
export function useLiveData({ operator = false }: { operator?: boolean } = {}): LiveData {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => seedSnapshot())
  const [connection, setConnection] = useState<Connection>('connecting')
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [newCritical, setNewCritical] = useState<Incident[]>([])
  const [rules, setRules] = useState<AutomationRules>(() => getLocalRules())
  const [myReports, setMyReports] = useState<MyReport[]>(loadMyReports)
  const rememberReport = useCallback((r: MyReport) => {
    setMyReports((list) => {
      const next = [r, ...list.filter((x) => x.id !== r.id)].slice(0, 30)
      localStorage.setItem(MY_REPORTS_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const snapRef = useRef(snapshot)
  useEffect(() => {
    snapRef.current = snapshot
  }, [snapshot])
  const seenIds = useRef<Set<string>>(new Set(snapshot.incidents.map((i) => i.id)))
  const lastMsgAt = useRef<number>(0)
  const connectionRef = useRef<Connection>('connecting')
  useEffect(() => {
    connectionRef.current = connection
  }, [connection])
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
      ws = new WebSocket(`${proto}://${location.host}/ws${operator ? '?role=operator' : ''}`)
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
          if (msg.data.meta?.rules) {
            setLocalRules(msg.data.meta.rules)
            setRules(msg.data.meta.rules)
          }
        } else if (msg.type === 'meta.update') {
          setSnapshot((s) => ({ ...s, meta: msg.data }))
          if (msg.data.rules) {
            setLocalRules(msg.data.rules)
            setRules(msg.data.rules)
          }
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
  }, [applyIncident, operator])

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
        const at = new Date().toISOString()
        const done: Incident = { ...inc, verifying: false, verification: v, updated_at: at }
        if (v.verdict === 'false_alarm' && v.confidence >= getLocalRules().false_alarm_hide_min) {
          Object.assign(done, { status: 'resolved', resolution: 'false_alarm', resolved_at: at, resolved_by: 'ai' })
        }
        const d = done.status === 'active' ? routeDispatch(done, v) : undefined
        if (d) done.dispatch = d
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
      // Sama seperti backend: kejadian simulasi selesai setelah 8 menit, maksimal 12 aktif
      setSnapshot((snap) => {
        const sims = snap.incidents
          .filter((i) => i.id.startsWith('sim-') && i.status === 'active')
          .sort((a, b) => b.reported_at.localeCompare(a.reported_at))
        const expire = new Set(
          sims
            .filter((i, idx) => (idx >= 12 || Date.now() - Date.parse(i.reported_at) > 8 * 60_000) && !isPending(i))
            .map((i) => i.id),
        )
        if (expire.size === 0) return snap
        const at = new Date().toISOString()
        return {
          ...snap,
          incidents: snap.incidents.map((i) =>
            expire.has(i.id) ? { ...i, status: 'resolved', resolution: 'expired', resolved_at: at, resolved_by: 'system' } : i,
          ),
        }
      })
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
      incidents: s.incidents.map((i) => (i.id === id && i.dispatch && isPending(i) ? { ...i, dispatch: resolveDispatch(i.dispatch, how) } : i)),
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
            const { reporter_token, ...inc } = (await res.json()) as Incident & { reporter_token?: string }
            if (reporter_token) rememberReport({ id: inc.id, token: reporter_token, at: inc.reported_at })
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
      rememberReport({ id: inc.id, token: 'local', at: now })
      window.setTimeout(() => applyIncident({ ...inc, verifying: false, verification: heuristicVerify(inc) }), 2000)
      return inc
    },
    [applyIncident, rememberReport],
  )

  const patchLocal = useCallback((id: string, fn: (i: Incident) => Incident) => {
    setSnapshot((s) => ({ ...s, incidents: s.incidents.map((i) => (i.id === id ? { ...fn(i), updated_at: new Date().toISOString() } : i)) }))
  }, [])

  const online = () => connectionRef.current !== 'offline'

  const updateRules = useCallback(async (patch: Partial<AutomationRules>) => {
    if (online()) {
      const r = await send<AutomationRules>('/api/automation', patch, 'PUT')
      if (r) {
        setLocalRules(r)
        setRules(r)
        return
      }
    }
    const next = { ...getLocalRules(), ...patch }
    setLocalRules(next)
    setRules(next)
  }, [])

  const resolveIncident = useCallback(
    async (id: string, reason: CloseReason, note?: string) => {
      if (online()) {
        const inc = await send<Incident>(`/api/incidents/${encodeURIComponent(id)}/resolve`, { reason, note: note || undefined })
        if (inc) return applyIncident(inc)
      }
      const cur = snapRef.current.incidents.find((i) => i.id === id)
      if (reason === 'handled' && cur && isPending(cur)) throw new Error('Putuskan dispatch 112 dulu sebelum menandai kejadian selesai')
      const at = new Date().toISOString()
      patchLocal(id, (i) => {
        const dispatch = i.dispatch && isPending(i) ? resolveDispatch(i.dispatch, 'cancelled') : i.dispatch
        const notes = note?.trim() ? [...(i.notes ?? []), { at, author: 'operator' as const, text: note.trim() }] : i.notes
        return { ...i, dispatch, notes, status: 'resolved', resolution: reason, resolved_at: at, resolved_by: 'operator' }
      })
    },
    [applyIncident, patchLocal],
  )

  const addNote = useCallback(
    async (id: string, text: string, kind: Exclude<NoteKind, 'reply'> = 'note') => {
      if (online()) {
        const inc = await send<Incident>(`/api/incidents/${encodeURIComponent(id)}/notes`, { text, kind })
        if (inc) return applyIncident(inc)
      }
      patchLocal(id, (i) => ({ ...i, notes: [...(i.notes ?? []), { at: new Date().toISOString(), author: 'operator', text: text.trim(), kind }] }))
    },
    [applyIncident, patchLocal],
  )

  const replyReport = useCallback(
    async (id: string, text: string) => {
      const mine = myReports.find((r) => r.id === id)
      if (!mine) throw new Error('Laporan ini tidak dikirim dari perangkat ini')
      if (online() && mine.token !== 'local') {
        const inc = await send<Incident>(`/api/reports/${encodeURIComponent(id)}/reply`, { token: mine.token, text })
        if (inc) return applyIncident(inc)
      }
      patchLocal(id, (i) => ({ ...i, notes: [...(i.notes ?? []), { at: new Date().toISOString(), author: 'pelapor', text: text.trim(), kind: 'reply' }] }))
    },
    [applyIncident, patchLocal, myReports],
  )

  const manualDispatchAction = useCallback(
    async (id: string) => {
      if (online()) {
        const inc = await send<Incident>(`/api/incidents/${encodeURIComponent(id)}/dispatch/manual`, {})
        if (inc) return applyIncident(inc)
      }
      patchLocal(id, (i) => ({ ...i, dispatch: manualDispatch(i) }))
    },
    [applyIncident, patchLocal],
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
    rules,
    updateRules,
    resolveIncident,
    addNote,
    manualDispatch: manualDispatchAction,
    myReports,
    replyReport,
  }
}
