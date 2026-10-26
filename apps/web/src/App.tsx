import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MEDELLIN_CENTER, EVENT_CATEGORIES } from '@parche/shared'

export default function App() {
  const center: [number, number] = [MEDELLIN_CENTER.lat, MEDELLIN_CENTER.lng]

  return (
    <div className="flex h-screen flex-col">
      <header className="p-4 font-bold text-teal-800">
        Parche · {EVENT_CATEGORIES.length} categorías
      </header>
      <MapContainer center={center} zoom={13} className="flex-1">
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker center={center} radius={10} />
      </MapContainer>
    </div>
  )
}
