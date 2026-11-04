import { Cctv } from 'lucide-react'
import type { CameraCluster } from '../../lib/cameraLayout'

interface Props {
  cluster: CameraCluster
  onZoom: (c: CameraCluster) => void
}

/** Penanda gabungan semua CCTV satu kota. Latar solid (tanpa blur) supaya ringan saat peta digeser. */
export function CameraClusterMarker({ cluster, onZoom }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onZoom(cluster)
      }}
      aria-label={`${cluster.count} CCTV di ${cluster.city}, ${cluster.live} siaran langsung. Perbesar peta`}
      title={`${cluster.city}: ${cluster.count} CCTV`}
      className="flex h-6 items-center gap-1 rounded-md border border-white/15 bg-[#10141B] pl-1.5 pr-2 shadow-[0_2px_8px_rgb(0_0_0/0.6)] transition-colors hover:border-white/50"
    >
      <Cctv size={13} className="text-fg" aria-hidden />
      <span className="text-[12px] font-semibold leading-none text-fg tabular">{cluster.count}</span>
      {cluster.live > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[#F2555A]" aria-hidden />}
    </button>
  )
}
