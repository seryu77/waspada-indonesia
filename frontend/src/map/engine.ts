export const hasGoogleKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
export const MAP_ENGINE = hasGoogleKey ? 'Google Maps' : 'Leaflet + Stadia (OSM)'
