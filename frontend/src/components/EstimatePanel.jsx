import './EstimatePanel.css'
import { useEffect, useMemo, useState } from 'react'

export default function EstimatePanel({
  onEstimate,
  auxiliaryError = '',
  zipMetaByZip = {},
  open: controlledOpen,
  onOpenChange,
  activeZip: controlledActiveZip,
  onActiveZipChange,
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true)
  const [zipInput, setZipInput] = useState('')
  const [uncontrolledActiveZip, setUncontrolledActiveZip] = useState('')
  const [sunroof, setSunroof] = useState(null)
  const [sunroofStatus, setSunroofStatus] = useState({ loading: false, error: '' })

  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next) => {
    onOpenChange?.(next)
    if (controlledOpen == null) setUncontrolledOpen(next)
  }

  const activeZip = controlledActiveZip ?? uncontrolledActiveZip
  const setActiveZip = (next) => {
    onActiveZipChange?.(next)
    if (controlledActiveZip == null) setUncontrolledActiveZip(next)
  }

  useEffect(() => {
    const z = String(activeZip || '').trim()
    if (!z) return
    setZipInput(z)
  }, [activeZip])

  const estimate = useMemo(() => buildFakeEstimate(activeZip), [activeZip])
  const boundaryOptimalityScore = useMemo(() => {
    const z = String(activeZip || '').trim()
    if (!z) return null
    const meta = zipMetaByZip?.[z]
    const score = meta?.optimalityScore
    return Number.isFinite(score) ? score : null
  }, [activeZip, zipMetaByZip])
  const displayedOptimalityScore = boundaryOptimalityScore ?? (activeZip ? estimate.solarOptimalityScore : null)

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    if (open) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!activeZip) {
        setSunroof(null)
        setSunroofStatus({ loading: false, error: '' })
        return
      }
      try {
        setSunroofStatus({ loading: true, error: '' })
        const result = await mockFetchGoogleSunroof(activeZip)
        if (!cancelled) setSunroof(result)
      } catch (e) {
        if (!cancelled) setSunroofStatus({ loading: false, error: e?.message || String(e) })
        return
      } finally {
        if (!cancelled) setSunroofStatus((s) => ({ ...s, loading: false }))
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [activeZip])

  return (
    <>
      {open ? (
        <button
          className="estimateDrawerOverlay"
          type="button"
          aria-label="Close estimate drawer"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside className={`estimateDrawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="estimateDrawerHeader">
          <div className="estimateDrawerHeaderLeft">
            <div className="estimateDrawerTitle">estimate</div>
            <div className="estimateDrawerSub">
              {activeZip ? (
                <>
                  zipcode <span className="estimateDrawerZip">{activeZip}</span>
                </>
              ) : (
                'no zipcode selected'
              )}
            </div>
          </div>
          <button className="estimateDrawerClose" type="button" onClick={() => setOpen(false)}>
            close
          </button>
        </div>

        <div className="estimateDrawerScroll">
          <div className="estimatePanel">
            <div className="estimateHero">
              <div className="estimateHeroTop">
                <div className="estimateBigNumber">{displayedOptimalityScore ?? '—'}</div>
                <div className="estimateBigNumberLabel">solar optimality score</div>
              </div>

              <div className="estimateHeroBottom">
                <div className="estimateHeroRow">
                  <div className="estimatePill">
                    <div className="estimatePillLabel">google sunroof estimate</div>
                    <div className="estimatePillValue">
                      {activeZip ? (
                        sunroofStatus.loading ? (
                          'loading…'
                        ) : sunroof ? (
                          <>
                            save <strong>{formatCurrency(sunroof.annualSavingsUsd)}</strong>/yr (
                            <strong>{Math.round(sunroof.savingsPercent)}%</strong>)
                          </>
                        ) : (
                          'unavailable'
                        )
                      ) : (
                        'enter a zipcode below'
                      )}
                    </div>
                  </div>

                  <div className="estimatePill">
                    <div className="estimatePillLabel">10-year net delta (solar vs no solar)</div>
                    <div className="estimatePillValue">
                      {activeZip ? (
                        <>
                          <strong>{formatCurrency(estimate.tenYearNetSavingsUsd)}</strong> saved
                        </>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>
                </div>

                {sunroofStatus.error ? <div className="estimateError">{sunroofStatus.error}</div> : null}
                {auxiliaryError ? <div className="estimateError">{auxiliaryError}</div> : null}
              </div>
            </div>

            <div className="estimateSection">
              <div className="estimateSectionTitle">next 10 years</div>
              <div className="estimateGrid">
                <ChartCard
                  title="cost (with vs without solar)"
                  subtitle="projected annual bill"
                  value={
                    activeZip
                      ? `${formatCurrency(estimate.costWithSolar.at(-1)?.value ?? 0)} vs ${formatCurrency(
                          estimate.costWithoutSolar.at(-1)?.value ?? 0,
                        )}`
                      : '—'
                  }
                  className="estimateCardFull"
                >
                  <DualLineChart
                    seriesA={estimate.costWithSolar}
                    seriesB={estimate.costWithoutSolar}
                    labelA="with solar"
                    labelB="without solar"
                    colorA="#16a34a"
                    colorB="#ef4444"
                    unitFormatter={(v) => formatCurrency(v)}
                  />
                </ChartCard>

                <ChartCard
                  title="carbon (with vs without solar)"
                  subtitle="metric tons CO₂e / year"
                  value={
                    activeZip
                      ? `${formatTons(estimate.emissionsWithSolar.at(-1)?.value ?? 0)} vs ${formatTons(
                          estimate.emissionsWithoutSolar.at(-1)?.value ?? 0,
                        )}`
                      : '—'
                  }
                  className="estimateCardFull"
                >
                  <DualLineChart
                    seriesA={estimate.emissionsWithSolar}
                    seriesB={estimate.emissionsWithoutSolar}
                    labelA="with solar"
                    labelB="without solar"
                    colorA="#0ea5e9"
                    colorB="#a855f7"
                    unitFormatter={(v) => formatTons(v)}
                  />
                </ChartCard>
              </div>
            </div>

            <div className="estimateSection">
              <div className="estimateSectionTitle">other features (mocked)</div>
              <div className="estimateFeatureGrid">
                {estimate.features.map((f) => (
                  <div key={f.label} className="estimateFeature">
                    <div className="estimateFeatureLabel">{f.label}</div>
                    <div className="estimateFeatureValue">{f.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="estimateZipFooter">
              <div className="estimateZipSubheader">{activeZip ? `zipcode ${activeZip}` : 'zipcode'}</div>
              <div className="estimateZipControls">
                <input
                  id="zipcode"
                  className="estimateInput"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="e.g. 92101"
                  value={zipInput}
                  onChange={(e) => setZipInput(e.target.value)}
                />

                <button
                  className="estimateButton"
                  type="button"
                  onClick={() => {
                    const trimmed = zipInput.trim()
                    setActiveZip(trimmed)
                    onEstimate?.(trimmed)
                    setOpen(true)
                  }}
                >
                  estimate
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

function ChartCard({ title, subtitle, value, children, className = '' }) {
  return (
    <div className={`estimateCard ${className}`.trim()}>
      <div className="estimateCardHeader">
        <div className="estimateCardTitle">{title}</div>
        <div className="estimateCardSubtitle">{subtitle}</div>
        <div className="estimateCardValue">{value}</div>
      </div>
      <div className="estimateCardBody">{children}</div>
    </div>
  )
}

function MiniLineChart({ series, color, unitFormatter }) {
  const width = 320
  const height = 120
  const pad = 10
  const usableW = width - pad * 2
  const usableH = height - pad * 2

  const safeSeries = Array.isArray(series) ? series : []
  const values = safeSeries.map((p) => p.value)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const span = max - min || 1

  function xAt(i) {
    if (safeSeries.length <= 1) return pad
    return pad + (i / (safeSeries.length - 1)) * usableW
  }

  function yAt(v) {
    const t = (v - min) / span
    return pad + (1 - t) * usableH
  }

  const points = safeSeries
    .map((p, i) => `${xAt(i).toFixed(2)},${yAt(p.value).toFixed(2)}`)
    .join(' ')

  const first = safeSeries.at(0)
  const last = safeSeries.at(-1)

  return (
    <div className="estimateChart">
      <svg
        className="estimateChartSvg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        role="img"
        aria-label="timeseries chart"
      >
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="axis" />
        {safeSeries.length >= 2 ? (
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </svg>

      <div className="estimateChartMeta">
        <div className="estimateChartMetaRow">
          <span className="estimateChartMetaKey">{first?.year ?? ''}</span>
          <span className="estimateChartMetaVal">{first ? unitFormatter(first.value) : '—'}</span>
        </div>
        <div className="estimateChartMetaRow">
          <span className="estimateChartMetaKey">{last?.year ?? ''}</span>
          <span className="estimateChartMetaVal">{last ? unitFormatter(last.value) : '—'}</span>
        </div>
      </div>
    </div>
  )
}

function DualLineChart({
  seriesA,
  seriesB,
  labelA,
  labelB,
  colorA,
  colorB,
  unitFormatter,
}) {
  const width = 320
  const height = 120
  const pad = 10
  const usableW = width - pad * 2
  const usableH = height - pad * 2

  const a = Array.isArray(seriesA) ? seriesA : []
  const b = Array.isArray(seriesB) ? seriesB : []
  const n = Math.max(a.length, b.length)
  const [hoverIdx, setHoverIdx] = useState(null)

  const values = [...a.map((p) => p.value), ...b.map((p) => p.value)].filter((v) => Number.isFinite(v))
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const span = max - min || 1

  function xAt(i) {
    if (n <= 1) return pad
    return pad + (i / (n - 1)) * usableW
  }

  function yAt(v) {
    const t = (v - min) / span
    return pad + (1 - t) * usableH
  }

  function pointsFor(series) {
    return series.map((p, i) => `${xAt(i).toFixed(2)},${yAt(p.value).toFixed(2)}`).join(' ')
  }

  const pointsA = pointsFor(a)
  const pointsB = pointsFor(b)

  const lastA = a.at(-1)
  const lastB = b.at(-1)

  const activeA = hoverIdx != null ? a[hoverIdx] : null
  const activeB = hoverIdx != null ? b[hoverIdx] : null
  const activeX = hoverIdx != null ? xAt(hoverIdx) : null
  const activeYear = activeA?.year ?? activeB?.year ?? ''

  const tooltip =
    hoverIdx != null
      ? {
          year: activeYear,
          a: activeA ? unitFormatter(activeA.value) : '—',
          b: activeB ? unitFormatter(activeB.value) : '—',
          leftPct: activeX != null ? (activeX / width) * 100 : 0,
        }
      : null

  function setFromClientX(clientX, rect) {
    if (!rect || n <= 1) return
    const t = (clientX - rect.left) / rect.width
    const clamped = Math.max(0, Math.min(1, t))
    setHoverIdx(Math.round(clamped * (n - 1)))
  }

  return (
    <div className="estimateChart">
      <div className="estimateLegend">
        <div className="estimateLegendItem">
          <span className="estimateLegendSwatch" style={{ background: colorA }} />
          <span className="estimateLegendLabel">
            {labelA}
            {lastA ? ` · ${unitFormatter(lastA.value)}` : ''}
          </span>
        </div>
        <div className="estimateLegendItem">
          <span className="estimateLegendSwatch" style={{ background: colorB }} />
          <span className="estimateLegendLabel">
            {labelB}
            {lastB ? ` · ${unitFormatter(lastB.value)}` : ''}
          </span>
        </div>
      </div>

      {tooltip ? (
        <div className="estimateTooltip" style={{ left: `${tooltip.leftPct}%` }}>
          <div className="estimateTooltipYear">{tooltip.year}</div>
          <div className="estimateTooltipRow">
            <span className="estimateTooltipSwatch" style={{ background: colorA }} />
            <span className="estimateTooltipLabel">{labelA}</span>
            <span className="estimateTooltipValue">{tooltip.a}</span>
          </div>
          <div className="estimateTooltipRow">
            <span className="estimateTooltipSwatch" style={{ background: colorB }} />
            <span className="estimateTooltipLabel">{labelB}</span>
            <span className="estimateTooltipValue">{tooltip.b}</span>
          </div>
        </div>
      ) : null}

      <svg
        className="estimateChartSvg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        role="img"
        aria-label="timeseries chart"
        onMouseMove={(e) => {
          setFromClientX(e.clientX, e.currentTarget.getBoundingClientRect())
        }}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => {
          const t = e.touches?.[0]
          if (!t) return
          setFromClientX(t.clientX, e.currentTarget.getBoundingClientRect())
        }}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="axis" />
        {a.length >= 2 ? (
          <polyline
            points={pointsA}
            fill="none"
            stroke={colorA}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        ) : null}
        {b.length >= 2 ? (
          <polyline
            points={pointsB}
            fill="none"
            stroke={colorB}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        ) : null}

        {activeX != null ? (
          <line
            x1={activeX}
            y1={pad}
            x2={activeX}
            y2={height - pad}
            stroke="rgba(17, 24, 39, 0.22)"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        ) : null}

        {activeX != null && activeA ? (
          <circle
            cx={activeX}
            cy={yAt(activeA.value)}
            r="4.5"
            fill={colorA}
            stroke="#ffffff"
            strokeWidth="2"
            pointerEvents="none"
          />
        ) : null}

        {activeX != null && activeB ? (
          <circle
            cx={activeX}
            cy={yAt(activeB.value)}
            r="4.5"
            fill={colorB}
            stroke="#ffffff"
            strokeWidth="2"
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  )
}

function buildFakeEstimate(zip) {
  const normalized = String(zip || '').trim()
  const nowYear = new Date().getFullYear()
  const seed = normalized ? hashToUnitInterval(normalized) : 0.42

  const solarOptimalityScore = Math.round(55 + seed * 40) // 55..95
  const electricityRateInflation = 0.035 + seed * 0.02 // 3.5%..5.5%
  const baselineYearCost = 2400 + seed * 1400 // $2400..$3800
  const solarYear1SavingsPct = 0.22 + seed * 0.2 // 22%..42%
  const solarDegradation = 0.006 + seed * 0.004 // 0.6%..1.0%
  const carbonIntensityTons = 3.6 + seed * 2.8 // 3.6..6.4 tons/yr baseline
  const gridDecarb = 0.01 + seed * 0.015 // 1.0%..2.5%/yr improvement

  const years = Array.from({ length: 10 }, (_, i) => nowYear + i)
  const costWithoutSolar = years.map((y, i) => ({
    year: y,
    value: roundTo(baselineYearCost * (1 + electricityRateInflation) ** i, 0),
  }))

  const costWithSolar = years.map((y, i) => {
    const inflationFactor = (1 + electricityRateInflation) ** i
    const savingsFactor = Math.max(
      0.08,
      solarYear1SavingsPct * (1 - solarDegradation) ** i, // savings slowly erode
    )
    const baseline = baselineYearCost * inflationFactor
    return { year: y, value: roundTo(baseline * (1 - savingsFactor), 0) }
  })

  const emissionsWithoutSolar = years.map((y, i) => ({
    year: y,
    value: roundTo(carbonIntensityTons * (1 - gridDecarb) ** i, 2),
  }))

  const emissionsWithSolar = years.map((y, i) => ({
    year: y,
    value: roundTo(emissionsWithoutSolar[i].value * (0.45 - seed * 0.12), 2), // 33%..45% of baseline
  }))

  const tenYearNoSolar = sum(costWithoutSolar.map((p) => p.value))
  const tenYearSolar = sum(costWithSolar.map((p) => p.value))
  const tenYearNetSavingsUsd = roundTo(tenYearNoSolar - tenYearSolar, 0)

  const features = [
    { label: 'estimated system size', value: `${roundTo(4.2 + seed * 6.1, 1)} kW` },
    { label: 'payback period', value: `${roundTo(5.5 + (1 - seed) * 4.0, 1)} yrs` },
    { label: 'roof shading', value: `${Math.round(8 + seed * 22)}%` },
    { label: 'battery recommended', value: seed > 0.55 ? 'yes' : 'optional' },
    { label: 'grid outage impact', value: seed > 0.65 ? 'high' : 'medium' },
    { label: 'rebate eligibility', value: seed > 0.3 ? 'likely' : 'unknown' },
  ]

  return {
    solarOptimalityScore,
    costWithSolar,
    costWithoutSolar,
    emissionsWithSolar,
    emissionsWithoutSolar,
    tenYearNetSavingsUsd,
    features,
  }
}

async function mockFetchGoogleSunroof(zip) {
  const normalized = String(zip || '').trim()
  if (!normalized) throw new Error('Missing zipcode')

  // Simulated latency for an API call
  await sleep(350)

  const seed = hashToUnitInterval(normalized)
  const annualBill = 2600 + seed * 1600
  const savingsPercent = 22 + seed * 23 // 22..45
  const annualSavingsUsd = roundTo((annualBill * savingsPercent) / 100, 0)
  const roofAreaM2 = roundTo(55 + seed * 95, 0)
  const solarHoursPerYear = roundTo(1500 + seed * 550, 0)

  return { annualSavingsUsd, savingsPercent, roofAreaM2, solarHoursPerYear }
}

function hashToUnitInterval(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sum(nums) {
  return nums.reduce((acc, n) => acc + n, 0)
}

function roundTo(n, digits) {
  const m = 10 ** digits
  return Math.round(n * m) / m
}

function formatCurrency(n) {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v)
}

function formatTons(n) {
  const v = Number.isFinite(n) ? n : 0
  return `${roundTo(v, 2)} t`
}

