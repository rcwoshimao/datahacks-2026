import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import EstimatePanel from '../components/EstimatePanel.jsx'
import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import './MapPage.css'

const SAN_DIEGO = [32.7157, -117.1611]
const ZIPCODE_GEOJSON_URL = '/api/zipcode_geojson?limit=200'
const ZIPCODE_CACHE_KEY = `zipcode_geojson_cache_v1:${ZIPCODE_GEOJSON_URL}`
const ZIPCODE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24h

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function toHexByte(n) {
  const v = Math.max(0, Math.min(255, Math.round(n)))
  return v.toString(16).padStart(2, '0')
}

function lerpColor(hexA, hexB, t) {
  const a = hexA.replace('#', '')
  const b = hexB.replace('#', '')
  const ar = Number.parseInt(a.slice(0, 2), 16)
  const ag = Number.parseInt(a.slice(2, 4), 16)
  const ab = Number.parseInt(a.slice(4, 6), 16)
  const br = Number.parseInt(b.slice(0, 2), 16)
  const bg = Number.parseInt(b.slice(2, 4), 16)
  const bb = Number.parseInt(b.slice(4, 6), 16)
  return `#${toHexByte(lerp(ar, br, t))}${toHexByte(lerp(ag, bg, t))}${toHexByte(lerp(ab, bb, t))}`
}

function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
        break
      case gn:
        h = ((bn - rn) / d + 2) * 60
        break
      default:
        h = ((rn - gn) / d + 4) * 60
        break
    }
  }

  return { h, s, l }
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]

  const m = l - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

function boostHexSaturation(hex, factor) {
  const raw = String(hex).trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return hex
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  const { h, s, l } = rgbToHsl(r, g, b)
  const boosted = clamp01(s * factor)
  const out = hslToRgb(h, boosted, l)
  return `#${toHexByte(out.r)}${toHexByte(out.g)}${toHexByte(out.b)}`
}

function scoreToT(score) {
  // backend generates 55..95 (but clamp anyway)
  const s = Number(score)
  return clamp01((s - 55) / 40)
}

function FitToSelectedZip({ selectedZip, boundaries }) {
  const map = useMap()

  useEffect(() => {
    if (!map || !selectedZip || !boundaries?.features?.length) return

    const normalized = String(selectedZip).trim()
    if (!normalized) return

    const matches = boundaries.features.filter((f) => {
      const p = f?.properties ?? {}
      const z = p.zip ?? p.zipcode ?? p.ZIP ?? p.postal_code
      return z != null && String(z).trim() === normalized
    })

    if (!matches.length) return

    try {
      const layer = L.geoJSON({ type: 'FeatureCollection', features: matches })
      const bounds = layer.getBounds()
      if (bounds?.isValid?.()) {
        map.fitBounds(bounds, { padding: [24, 24] })
      }
    } catch {
      // ignore fit errors; map still renders boundaries
    }
  }, [boundaries, map, selectedZip])

  return null
}

export default function MapPage() {
  const [boundaries, setBoundaries] = useState(null)
  const [selectedZip, setSelectedZip] = useState('')
  const [loadError, setLoadError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoadError('')

        // Serve cached polygons immediately (if available), then revalidate.
        try {
          const raw = localStorage.getItem(ZIPCODE_CACHE_KEY)
          if (raw) {
            const cached = JSON.parse(raw)
            const ageOk =
              typeof cached?.ts === 'number' && Date.now() - cached.ts < ZIPCODE_CACHE_TTL_MS
            if (ageOk && cached?.data?.features?.length && !cancelled) {
              setBoundaries(cached.data)
            }
          }
        } catch {
          // ignore cache parse issues
        }

        const res = await fetch(ZIPCODE_GEOJSON_URL)
        if (!res.ok) {
          const txt = await res.text()
          throw new Error(txt || `HTTP ${res.status}`)
        }
        const geo = await res.json()
        if (!cancelled) setBoundaries(geo)

        // Cache best-effort (localStorage can quota-fail).
        try {
          const payload = JSON.stringify({ ts: Date.now(), data: geo })
          // Avoid blowing up localStorage on huge payloads (~5MB typical limit).
          if (payload.length < 4_500_000) localStorage.setItem(ZIPCODE_CACHE_KEY, payload)
        } catch {
          // ignore cache write issues
        }
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || String(e))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const boundaryStyle = useMemo(() => {
    const lowFill = '#bbd0ff'
    const highFill = '#d4153b'
    const stroke = '#000000'
    const saturationBoost = 10.0

    return (feature, opts = {}) => {
      const p = feature?.properties ?? {}
      const t = scoreToT(p.optimalityScore)
      const fillColor = boostHexSaturation(lerpColor(lowFill, highFill, t), saturationBoost)
      const baseFillOpacity = lerp(0.28, 0.72, t)
      const hoverBoost = opts.hover ? 0.06 : 0

      return {
        color: stroke,
        weight: opts.hover ? 2 : 1,
        opacity: opts.hover ? 0.95 : 0.8,
        fillColor,
        fillOpacity: clamp01(baseFillOpacity + hoverBoost),
      }
    }
  }, [])

  const onEachBoundary = useMemo(() => {
    return (feature, layer) => {
      layer.on('click', () => {
        const p = feature?.properties ?? {}
        const z = p.zip ?? p.zipcode ?? p.ZIP ?? p.postal_code
        if (!z) return
        const normalized = String(z).trim()
        setSelectedZip(normalized)
        setDrawerOpen(true)
        setAutoZoomEnabled(false)
      })

      layer.on('mouseover', () => {
        layer.setStyle(boundaryStyle(feature, { hover: true }))
      })

      layer.on('mouseout', () => {
        layer.setStyle(boundaryStyle(feature))
      })
    }
  }, [boundaryStyle])

  const selectedStyle = useMemo(
    () => ({
      color: '#ef4444',
      weight: 3,
      opacity: 0.95,
      fillOpacity: 0.08,
    }),
    [],
  )

  const selectedFeatures = useMemo(() => {
    const normalized = selectedZip.trim()
    if (!normalized || !boundaries?.features?.length) return null

    const matches = boundaries.features.filter((f) => {
      const p = f?.properties ?? {}
      const z = p.zip ?? p.zipcode ?? p.ZIP ?? p.postal_code
      return z != null && String(z).trim() === normalized
    })

    if (!matches.length) return null
    return { type: 'FeatureCollection', features: matches }
  }, [boundaries, selectedZip])

  const zipMetaByZip = useMemo(() => {
    const map = {}
    const feats = boundaries?.features
    if (!Array.isArray(feats)) return map
    for (const f of feats) {
      const p = f?.properties ?? {}
      const z = p.zip ?? p.zipcode ?? p.ZIP ?? p.postal_code
      if (!z) continue
      map[String(z).trim()] = {
        optimalityScore: p.optimalityScore,
      }
    }
    return map
  }, [boundaries])

  return (
    <div className="mapPage">
      <header className="topNav" role="banner">
        <div className="topNavBrand">ZenPower Solar Energy Prediction</div>
        <div className="topNavMeta">Click a zipcode region</div>
      </header>

      <div className="mapViewport">
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

          {boundaries?.features?.length ? (
            <>
              <GeoJSON
                data={boundaries}
                style={(feature) => boundaryStyle(feature)}
                onEachFeature={onEachBoundary}
              />
              {selectedFeatures ? (
                <GeoJSON
                  key={`selected:${selectedZip}`}
                  data={selectedFeatures}
                  style={selectedStyle}
                />
              ) : null}
              {autoZoomEnabled ? <FitToSelectedZip selectedZip={selectedZip} boundaries={boundaries} /> : null}
            </>
          ) : null}
        </MapContainer>
      </div>

      <EstimatePanel
        auxiliaryError={loadError ? `Map boundaries unavailable: ${loadError}` : ''}
        zipMetaByZip={zipMetaByZip}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        activeZip={selectedZip}
        onActiveZipChange={setSelectedZip}
        onEstimate={(zip) => {
          setSelectedZip(zip ?? '')
          setDrawerOpen(true)
          setAutoZoomEnabled(true)
        }}
      />
    </div>
  )
}

