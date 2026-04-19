import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import './Page2.css'

function mulberry32(seed) {
  let t = seed >>> 0
  return function rand() {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromZip(zip) {
  const digits = (zip ?? '').replace(/\D/g, '')
  if (!digits) return 92101
  return Number.parseInt(digits.slice(0, 9), 10) || 92101
}

function centerFromZip(zip) {
  const digits = (zip ?? '').replace(/\D/g, '').slice(0, 5)

  const known = {
    92101: [32.7197, -117.1637],
    92102: [32.7150, -117.1183],
    92103: [32.7477, -117.1683],
    92104: [32.7440, -117.1270],
    92105: [32.7385, -117.0927],
    92106: [32.7253, -117.2365],
    92107: [32.7456, -117.2456],
    92108: [32.7806, -117.1472],
    92109: [32.7983, -117.2340],
    92110: [32.7647, -117.1997],
    92111: [32.8030, -117.1720],
    92113: [32.6953, -117.1150],
    92115: [32.7606, -117.0730],
    92116: [32.7646, -117.1238],
    92117: [32.8246, -117.1981],
    92118: [32.6766, -117.1710],
    92119: [32.7867, -117.0361],
    92120: [32.7942, -117.0720],
    92121: [32.8997, -117.2067],
    92122: [32.8587, -117.2112],
    92123: [32.8087, -117.1364],
    92124: [32.8292, -117.1170],
    92126: [32.9156, -117.1420],
    92127: [33.0231, -117.1063],
    92128: [32.9999, -117.0727],
    92129: [32.9628, -117.1374],
    92130: [32.9595, -117.2279],
  }

  if (digits && known[digits]) return known[digits]
  return [32.7157, -117.1611] // fallback: San Diego
}

function buildFakeHeatPoints({ center, zip }) {
  const seed = seedFromZip(zip)
  const rand = mulberry32(seed)
  const [lat0, lng0] = center

  // Create two "hot spots" so it looks presentable.
  const hotspotA = {
    lat: lat0 + (rand() - 0.5) * 0.06,
    lng: lng0 + (rand() - 0.5) * 0.06,
  }
  const hotspotB = {
    lat: lat0 + (rand() - 0.5) * 0.09,
    lng: lng0 + (rand() - 0.5) * 0.09,
  }

  const points = []
  const n = 420
  for (let i = 0; i < n; i++) {
    const angle = rand() * Math.PI * 2
    const radius = Math.pow(rand(), 0.65) * 0.06 // degrees-ish
    const lat = lat0 + Math.cos(angle) * radius
    const lng = lng0 + Math.sin(angle) * radius

    const dA = Math.hypot(lat - hotspotA.lat, lng - hotspotA.lng)
    const dB = Math.hypot(lat - hotspotB.lat, lng - hotspotB.lng)

    const scoreA = Math.exp(-(dA * dA) / (2 * 0.014 * 0.014))
    const scoreB = 0.85 * Math.exp(-(dB * dB) / (2 * 0.018 * 0.018))
    const noise = 0.15 * rand()

    const intensity = Math.max(0, Math.min(1, scoreA + scoreB + noise))
    points.push([lat, lng, intensity])
  }

  return points
}

function HeatLayer({ points, options }) {
  const map = useMap()

  useEffect(() => {
    if (!map) return
    const layer = L.heatLayer(points, options).addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, options, points])

  return null
}

export default function Page2() {
  const [params] = useSearchParams()
  const zip = params.get('zip') ?? ''

  const center = useMemo(() => centerFromZip(zip), [zip])

  const points = useMemo(
    () =>
      buildFakeHeatPoints({
        center,
        zip,
      }),
    [center, zip],
  )

  const heatOptions = useMemo(
    () => ({
      radius: 30,
      blur: 22,
      maxZoom: 17,
      gradient: {
        0.15: '#2563eb',
        0.35: '#22c55e',
        0.6: '#facc15',
        0.85: '#f97316',
        1.0: '#ef4444',
      },
    }),
    [],
  )

  return (
    <main className="page2">
      <MapContainer className="page2Map" center={center} zoom={12} scrollWheelZoom>
        <TileLayer
          minZoom={0}
          maxZoom={20}
          attribution='&copy; <a href="https://www.stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
          url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
        />
        <HeatLayer points={points} options={heatOptions} />
      </MapContainer>

      <div className="page2Panel">
        <div className="page2Title">Solar efficiency heat map (fake)</div>
        <div className="page2Meta">
          Zipcode: <span className="page2Zip">{zip || '—'}</span>
        </div>
        <Link className="page2Link" to={zip ? `/?zip=${encodeURIComponent(zip)}` : '/'}>
          Back to map
        </Link>
      </div>
    </main>
  )
}

