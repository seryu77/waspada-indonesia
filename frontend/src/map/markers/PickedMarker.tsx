import { MapPin } from 'lucide-react'

export function PickedMarker() {
  return (
    <div className="-translate-y-3" aria-hidden>
      <MapPin size={32} color="#0F172A" fill="#F8FAFC" strokeWidth={1.8} />
    </div>
  )
}
