import { useEffect, useState, type ReactNode } from 'react'
import { motion, type PanInfo } from 'motion/react'

interface Props {
  expanded: boolean
  setExpanded: (v: boolean) => void
  summary: ReactNode
  children: ReactNode
}

const PEEK = 112

/** Panel kanan versi mobile: bottom sheet yang bisa ditarik. */
export function BottomSheet({ expanded, setExpanded, summary, children }: Props) {
  const [vh, setVh] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const height = Math.round(vh * 0.78)
  const collapsedY = height - PEEK

  const onPanEnd = (_: unknown, info: PanInfo) => {
    if (info.velocity.y > 400 || info.offset.y > 80) setExpanded(false)
    else if (info.velocity.y < -400 || info.offset.y < -80) setExpanded(true)
  }

  return (
    <motion.section
      aria-label="Daftar kejadian"
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-30 flex flex-col glass-strong rounded-t-3xl"
      style={{ height }}
      initial={{ y: height }}
      animate={{ y: expanded ? 0 : collapsedY }}
      transition={{ type: 'spring', stiffness: 380, damping: 40 }}
    >
      <motion.div
        className="shrink-0 touch-none px-3 pb-2 pt-2"
        onPanEnd={onPanEnd}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Ciutkan daftar kejadian' : 'Buka daftar kejadian'}
          className="mx-auto mb-2 flex h-6 w-16 items-center justify-center rounded-full"
        >
          <span className="h-1 w-10 bg-line-strong" aria-hidden />
        </button>
        {summary}
      </motion.div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{children}</div>
    </motion.section>
  )
}
