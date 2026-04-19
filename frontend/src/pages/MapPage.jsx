import { MapContainer, TileLayer } from 'react-leaflet'
import EstimatePanel from '../components/EstimatePanel.jsx'
import './MapPage.css'

const SAN_DIEGO = [32.7157, -117.1611]

export default function MapPage() {
  return (
    <div className="mapPage">
      <MapContainer
        className="leafletMap"
        center={SAN_DIEGO}
        zoom={12}
        scrollWheelZoom
      >
        <TileLayer
          minZoom={0}
          maxZoom={20}
          attribution='&copy; <a href="https://www.stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
          url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
        />
      </MapContainer>

      <div className="floatingPanel">
        <EstimatePanel />
      </div>
    </div>
  )
}

