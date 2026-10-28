const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' })
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
})

export function clockWIB(d: Date | string | number): string {
  return `${timeFmt.format(new Date(d))} WIB`
}

export function dateTimeWIB(d: Date | string | number): string {
  return `${dateTimeFmt.format(new Date(d))} WIB`
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'baru saja'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} mnt lalu`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} jam lalu`
  return `${Math.round(h / 24)} hari lalu`
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function coord(lat: number, lng: number): string {
  const ns = lat < 0 ? 'LS' : 'LU'
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${lng.toFixed(4)}° BT`
}
