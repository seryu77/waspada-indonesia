/**
 * Penggambar heatmap di canvas, dipakai Leaflet dan Google Maps.
 * Google Maps sudah mencabut HeatmapLayer bawaannya, jadi keduanya memakai renderer ini.
 *
 * Cara kerja: tiap titik digambar sebagai lingkaran buram hitam dengan transparansi sesuai bobot.
 * Titik yang bertumpuk makin pekat. Setelah itu tiap piksel diwarnai dari palet
 * berdasarkan kepekatannya (kuning = sedikit api, merah = banyak atau besar).
 */

export const HEAT_GRADIENT: [number, string][] = [
  [0.0, 'rgba(253, 224, 71, 0)'],
  [0.2, '#FDE047'],
  [0.45, '#FB923C'],
  [0.7, '#EF4444'],
  [1.0, '#B91C1C'],
]

/** CSS untuk legenda, sama dengan palet heatmap */
export const HEAT_CSS = `linear-gradient(90deg, ${HEAT_GRADIENT.slice(1)
  .map(([s, c]) => `${c} ${Math.round(s * 100)}%`)
  .join(', ')})`

/** Jari-jari titik dalam piksel, membesar saat zoom mendekat */
export function heatRadius(zoom: number) {
  return Math.round(Math.min(44, Math.max(16, 16 + (zoom - 4.5) * 4)))
}

function buildPalette() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 1
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 256, 0)
  for (const [stop, color] of HEAT_GRADIENT) g.addColorStop(stop, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 1)
  return ctx.getImageData(0, 0, 256, 1).data
}

let palette: Uint8ClampedArray | null = null

/**
 * Peredam intensitas. Saat zoom jauh ratusan titik menumpuk di satu tempat dan semuanya jadi
 * merah pekat. Bobot diskalakan supaya sel terpadat di layar pas mencapai merah,
 * sementara daerah yang lebih jarang tetap kuning atau oranye.
 */
function densityScale(points: [number, number, number, number?][], radius: number) {
  const cell = Math.max(8, radius)
  const sums = new Map<number, number>()
  let max = 0
  for (const [x, y, w, live] of points) {
    if (live) continue
    const k = Math.floor(x / cell) * 100_003 + Math.floor(y / cell)
    const v = (sums.get(k) ?? 0) + w
    sums.set(k, v)
    if (v > max) max = v
  }
  // Total bobot sekitar 3,5 menghasilkan kepekatan sekitar 95% (merah) di sel terpadat
  return max <= 3.5 ? 1 : 3.5 / max
}

export class HeatRenderer {
  readonly canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  private stamp: HTMLCanvasElement | null = null
  private stampRadius = 0

  constructor() {
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', opacity: '0.85' })
  }

  private getStamp(r: number) {
    if (this.stamp && this.stampRadius === r) return this.stamp
    const s = document.createElement('canvas')
    s.width = s.height = r * 2
    const ctx = s.getContext('2d')!
    const g = ctx.createRadialGradient(r, r, 0, r, r, r)
    g.addColorStop(0, 'rgba(0,0,0,1)')
    g.addColorStop(0.35, 'rgba(0,0,0,0.6)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, r * 2, r * 2)
    this.stamp = s
    this.stampRadius = r
    return s
  }

  /** points: [x, y, bobot 0-1, live] dalam piksel layar */
  draw(width: number, height: number, points: [number, number, number, number?][], radius: number) {
    const { canvas, ctx } = this
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    ctx.clearRect(0, 0, width, height)
    if (!points.length || !width || !height) return

    const visible = points.filter(([x, y]) => x >= -radius && y >= -radius && x <= width + radius && y <= height + radius)
    const scale = densityScale(visible, radius)
    const stamp = this.getStamp(radius)
    for (const [x, y, w, live] of visible) {
      ctx.globalAlpha = Math.min(1, Math.max(0.004, live ? w : w * scale))
      ctx.drawImage(stamp, x - radius, y - radius)
    }
    ctx.globalAlpha = 1

    palette ??= buildPalette()
    const img = ctx.getImageData(0, 0, width, height)
    const px = img.data
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i]
      if (a < 6) {
        px[i] = 0
        continue
      }
      const j = a * 4
      px[i - 3] = palette[j]
      px[i - 2] = palette[j + 1]
      px[i - 1] = palette[j + 2]
      // Titik tipis tetap terlihat di peta gelap
      px[i] = Math.min(235, 50 + a)
    }
    ctx.putImageData(img, 0, 0)
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
}
