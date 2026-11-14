import type { Camera, Incident } from '../../types'
import type { CameraCluster } from '../../lib/cameraLayout'
import { hasStream, isPortal } from '../../lib/camera'
import { HAZARDS, SEVERITY } from '../../lib/hazards'
import { effectiveSeverity } from '../../lib/sort'
import { SATELLITE_UNCONFIRMED, satelliteUnconfirmed } from '../../lib/citizen'

// Label aksesibel marker. Dipakai di tombol marker Leaflet dan sebagai title AdvancedMarker di Google Maps.

export function cameraMarkerLabel(camera: Camera): string {
  const online = camera.status === 'online'
  if (isPortal(camera)) return `${camera.name}: buka portal CCTV resmi`
  return `CCTV ${camera.name}, ${camera.city}, ${online ? 'online' : 'offline'}${hasStream(camera) ? ', siaran langsung' : ''}. ${camera.detections_today} deteksi hari ini`
}

export function clusterMarkerLabel(cluster: CameraCluster): string {
  return `${cluster.count} CCTV di ${cluster.city}, ${cluster.live} siaran langsung. Perbesar peta`
}

export function incidentMarkerLabel(incident: Incident): string {
  const note = satelliteUnconfirmed(incident) ? ` (${SATELLITE_UNCONFIRMED})` : ''
  return `${HAZARDS[incident.type].label}: ${incident.title}${note}, ${SEVERITY[effectiveSeverity(incident)].label}. ${incident.address}`
}
