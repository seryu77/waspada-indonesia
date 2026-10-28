import { useEffect, useState, type ReactNode } from 'react'
import { motion, type PanInfo } from 'motion/react'

interface Props {
  expanded: boolean
  setExpanded: (v: boolean) => void
  summary: ReactNode
  children: ReactNode
}

/** Tinggi saat diciutkan: pegangan + ringkasan saja, supaya tidak ada baris yang terpotong */
const PEEK = 80
const GAP = 8

/** Panel kanan versi mobile: bottom sheet yang bisa ditarik. */
export function BottomSheet({ expanded, setExpanded, summary, children }: Props) {
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const height = Math.round(vh * 0.8)
  const collapsedY = height - PEEK + GAP

  const onPanEnd = (_: unknown, info: PanInfo) => {
    if (info.velocity.y > 400 || info.offset.y > 80) setExpanded(false)
    else if (info.velocity.y < -400 || info.offset.y < -80) setExpanded(true)
  }

  return (
    <motion.section
      aria-label="Daftar kejadian"
      className="pointer-events-auto fixed inset-x-2 bottom-2 z-30 flex flex-col overflow-hidden glass-strong rounded-3xl"
      style={{ height }}
      initial={{ y: height }}
      animate={{ y: expanded ? 0 : collapsedY }}
      transition={{ type: 'spring', stiffness: 380, damping: 40 }}
    >
      <motion.div
        className="shrink-0 touch-none px-4 pb-3 pt-1.5"
        onPanEnd={onPanEnd}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Ciutkan daftar kejadian' : 'Buka daftar kejadian'}
          className="mx-auto mb-1.5 flex h-6 w-16 items-center justify-center rounded-full"
        >
          <span className="h-1 w-10 rounded-full bg-white/30" aria-hidden />
        </button>
        {summary}
      </motion.div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line pb-[env(safe-area-inset-bottom)]">{children}</div>
    </motion.section>
  )
}
