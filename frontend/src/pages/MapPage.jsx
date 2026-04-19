import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import EstimatePanel from '../components/EstimatePanel.jsx'
import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import './MapPage.css'
import solarScoresCsv from '../../../data/solar_opportunity/solar_opportunity_scores_2025.csv?raw'

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

function normalizeZipString(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  const digits = s.replace(/\D/g, '')
  if (!digits) return s
  return digits.padStart(5, '0')
}

function getZipFromProperties(p) {
  const z = p?.zip ?? p?.zipcode ?? p?.ZIP ?? p?.postal_code ?? p?.zip_code
  return normalizeZipString(z)
}

function parseSolarScoresByZip(csvText) {
  const text = String(csvText || '').trim()
  if (!text) return new Map()

  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return new Map()

  const header = lines[0].split(',')
  const idxZip = header.indexOf('zip_code')
  const idxYear = header.indexOf('year')
  const idxQuarter = header.indexOf('quarter')
  const idxSector = header.indexOf('sector')
  const idxScore = header.indexOf('opportunity_score')
  if (idxZip === -1 || idxYear === -1 || idxQuarter === -1 || idxSector === -1 || idxScore === -1) {
    return new Map()
  }

  // Keep latest (year, quarter) per zip for Residential sector (r).
  const bestByZip = new Map()

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]
    if (!row) continue
    const cols = row.split(',')
    const zip = normalizeZipString(cols[idxZip])
    const sector = String(cols[idxSector] || '').trim().toLowerCase()
    const year = Number(cols[idxYear])
    const quarter = Number(cols[idxQuarter])
    const score = Number.parseFloat(cols[idxScore])

    if (!zip || sector !== 'r' || !Number.isFinite(year) || !Number.isFinite(quarter) || !Number.isFinite(score)) {
      continue
    }

    const cur = bestByZip.get(zip)
    if (!cur || year > cur.year || (year === cur.year && quarter > cur.quarter)) {
      bestByZip.set(zip, { year, quarter, score })
    } else if (year === cur.year && quarter === cur.quarter && score > cur.score) {
      bestByZip.set(zip, { year, quarter, score })
    }
  }

  const byZip = new Map()
  for (const [zip, v] of bestByZip.entries()) {
    byZip.set(zip, { residential: v.score })
  }

  return byZip
}

const SOLAR_SCORES_BY_ZIP = parseSolarScoresByZip(solarScoresCsv)

function formatOpportunityScoreNumber(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 100))
}

function opportunityScoreToTFromZip(zip, fallbackOptimalityScore) {
  const z = normalizeZipString(zip)
  const fromCsv = SOLAR_SCORES_BY_ZIP.get(z)?.residential
  if (Number.isFinite(fromCsv)) return clamp01(fromCsv) // CSV is 0..1
  // Fallback to backend 55..95 scale if CSV missing for that zip.
  return scoreToT(fallbackOptimalityScore)
}

function buildQuantileTByZip(features) {
  if (!Array.isArray(features) || !features.length) return new Map()

  const rows = []
  for (const f of features) {
    const p = f?.properties ?? {}
    const z = getZipFromProperties(p)
    if (!z) continue
    const s = SOLAR_SCORES_BY_ZIP.get(z)?.residential
    if (!Number.isFinite(s)) continue
    rows.push({ z, s })
  }

  if (rows.length <= 1) return new Map()

  const sortedScores = rows
    .map((r) => r.s)
    .sort((a, b) => a - b)

  const denom = sortedScores.length - 1
  // For duplicates, assign the average rank so equal scores map to equal colors.
  const midRankByScore = new Map()
  for (let i = 0; i < sortedScores.length; i++) {
    const s = sortedScores[i]
    if (midRankByScore.has(s)) continue
    let j = i
    while (j + 1 < sortedScores.length && sortedScores[j + 1] === s) j++
    const mid = (i + j) / 2
    midRankByScore.set(s, mid / denom)
    i = j
  }

  const out = new Map()
  for (const { z, s } of rows) out.set(z, midRankByScore.get(s) ?? 0)
  return out
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function estimateLayerSizeScore(layer) {
  // Approximate size from geographic bounds (good enough for relative font sizing).
  try {
    const b = layer?.getBounds?.()
    if (!b) return 0
    const latSpan = Math.max(0, b.getNorth() - b.getSouth())
    const lngSpan = Math.max(0, b.getEast() - b.getWest())
    const a = latSpan * lngSpan
    if (!Number.isFinite(a) || a <= 0) return 0
    // sqrt compresses range; scaled to a ~0..1-ish score for typical zip polygons.
    return Math.sqrt(a) * 120
  } catch {
    return 0
  }
}

function fontSizePxForLayer(layer) {
  // Smaller polygons -> smaller text, larger polygons -> larger text.
  const s = estimateLayerSizeScore(layer)
  return clamp(8 + s, 8, 16)
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

  const quantileTByZip = useMemo(
    () => buildQuantileTByZip(boundaries?.features),
    [boundaries?.features],
  )

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
      const z = getZipFromProperties(p)
      // Use quantile rank to spread colors across the palette even when scores cluster high.
      const t = quantileTByZip.get(z) ?? opportunityScoreToTFromZip(z, p.optimalityScore)
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
  }, [quantileTByZip])

  const onEachBoundary = useMemo(() => {
    return (feature, layer) => {
      // Always-visible label (no click required): Residential opportunity score.
      try {
        const p = feature?.properties ?? {}
        const z = getZipFromProperties(p)
        if (z) {
          const scores = SOLAR_SCORES_BY_ZIP.get(z)
          const r = formatOpportunityScoreNumber(scores?.residential)
          if (r) {
            const fontPx = fontSizePxForLayer(layer)
            const label = `<div style="font-size:${fontPx}px">${r}</div>`
            layer.bindTooltip(label, {
              permanent: true,
              direction: 'center',
              className: 'zipScoreLabel',
              opacity: 1,
            })

            const center = layer?.getBounds?.()?.getCenter?.()
            if (center) layer.openTooltip(center)
            else layer.openTooltip()
          }
        }
      } catch {
        // ignore label errors
      }

      layer.on('click', () => {
        const p = feature?.properties ?? {}
        const z = getZipFromProperties(p)
        if (!z) return
        setSelectedZip(z)
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
      const z = getZipFromProperties(p)
      return z && z === normalized
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
      const z = getZipFromProperties(p)
      if (!z) continue
      const residential = SOLAR_SCORES_BY_ZIP.get(z)?.residential
      const pct = Number.isFinite(residential) ? Math.round(residential * 100) : null
      map[z] = {
        // Keep prop name for now; value is now the same number shown on-map (residential opportunity score 0..100).
        optimalityScore: Number.isFinite(pct) ? pct : p.optimalityScore,
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

