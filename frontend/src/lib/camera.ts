import type { Camera } from '../types'

/** Ambil ID video dari URL YouTube (watch?v=, youtu.be/, /live/, /embed/). */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

const PLAYABLE = new Set<Camera['stream_type']>(['youtube', 'embed', 'hls', 'snapshot'])

/** Kamera yang punya siaran yang bisa diputar di browser. */
export const hasStream = (c: Camera) => c.status === 'online' && PLAYABLE.has(c.stream_type) && Boolean(c.stream_url)

export const isPortal = (c: Camera) => c.stream_type === 'portal'
