import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Camera, Incident } from '../types'
import { IncidentFeed } from './IncidentFeed'
import { IncidentDetail } from './IncidentDetail'

interface Props {
  incidents: Incident[]
  selected: Incident | null
  cameras: Camera[]
  onSelect: (id: string) => void
  onBack: () => void
  onFocus: (i: Incident) => void
  onConfirm: (id: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
  header?: ReactNode
}

const slide = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  animate: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
}

/** Isi panel kanan: feed atau detail, dengan transisi geser. */
export function IncidentPanel({ incidents, selected, cameras, onSelect, onBack, onFocus, onConfirm, onCancel, header }: Props) {
  const dir = selected ? 1 : -1
  return (
    <AnimatePresence mode="wait" initial={false} custom={dir}>
      {selected ? (
        <motion.div
          key={`detail-${selected.id}`}
          custom={dir}
          variants={slide}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <IncidentDetail
            incident={selected}
            camera={cameras.find((c) => c.id === selected.camera_id)}
            onBack={onBack}
            onFocus={() => onFocus(selected)}
            onConfirm={() => onConfirm(selected.id)}
            onCancel={() => onCancel(selected.id)}
          />
        </motion.div>
      ) : (
        <motion.div key="feed" custom={dir} variants={slide} initial="initial" animate="animate" exit="exit" transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
          {header}
          <IncidentFeed incidents={incidents} selectedId={null} onSelect={onSelect} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
