import type { ReactNode } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import type { Camera, Incident, Snapshot } from '../types'
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
  operator: boolean
  autoMin?: number
  snapshot: Snapshot
  offline: boolean
}

// Feed -> detail bergeser ke kiri (masuk lebih dalam), detail -> feed sebaliknya. Keluar lebih cepat dari masuk.
const slide: Variants = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 20 }),
  animate: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -12, transition: { duration: 0.12 } }),
}

/** Isi panel kanan: feed atau detail, dengan transisi geser. */
export function IncidentPanel({ incidents, selected, cameras, onSelect, onBack, onFocus, onConfirm, onCancel, header, operator, autoMin, snapshot, offline }: Props) {
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
        >
          <IncidentDetail
            incident={selected}
            camera={cameras.find((c) => c.id === selected.camera_id)}
            onBack={onBack}
            onFocus={() => onFocus(selected)}
            onConfirm={() => onConfirm(selected.id)}
            onCancel={() => onCancel(selected.id)}
            operator={operator}
            autoMin={autoMin}
            snapshot={snapshot}
            offline={offline}
            onSelect={onSelect}
          />
        </motion.div>
      ) : (
        <motion.div key="feed" custom={dir} variants={slide} initial="initial" animate="animate" exit="exit">
          {header}
          <IncidentFeed incidents={incidents} selectedId={null} onSelect={onSelect} operator={operator} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
