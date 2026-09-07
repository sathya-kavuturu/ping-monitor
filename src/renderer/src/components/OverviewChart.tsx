import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { NetworkUpdate } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import { buildOverviewChartData } from '../lib/overview-chart'
import { DEFAULT_RANGE_MS } from '../lib/chart-data'
import { detectPacketLossAnomalies, type PacketLossAnomaly } from '../lib/packet-loss-anomaly'
import { plotOffsetCss } from '../lib/uplot-position'
import TimeRangeControls from './TimeRangeControls'
import IndividualLatencyChart from './IndividualLatencyChart'
import ChartAnomalyOverlay, { type AnomalyMarker } from './ChartAnomalyOverlay'

/** How far below the plot's top edge the anomaly-marker rail sits, in CSS px. */
const ANOMALY_RAIL_OFFSET = 10

function anomalyMarkerKey(targetId: string, index: number): string {
  return `${targetId}-${index}`
}

interface OverviewChartProps {
  targets: TargetWithStatus[]
  updatesByTarget: Record<string, NetworkUpdate[]>
}

type ViewMode = 'combined' | 'individual'

const COLOR_AXIS = '#8b91a2'
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)'

// A categorical palette distinct from the app's status colors (green/amber/
// red already mean online/degraded/offline elsewhere) - order here is
// arbitrary, not a health signal.
const PALETTE = [
  '#4f8cff',
  '#e6b93e',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
  '#facc15',
  '#34d399',
  '#fb923c'
]

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]
}

function buildOptions(
  width: number,
  height: number,
  labels: string[],
  onXScaleChange: (min: number, max: number) => void,
  onDraw: (u: uPlot) => void
): uPlot.Options {
  return {
    width,
    height,
    padding: [12, 12, 0, 0],
    scales: {
      x: { time: true },
      y: { range: (_self, _min, max) => [0, Math.max(50, max * 1.2)] }
    },
    axes: [
      { stroke: COLOR_AXIS, grid: { stroke: COLOR_GRID }, ticks: { stroke: COLOR_GRID } },
      {
        label: 'Latency (ms)',
        stroke: COLOR_AXIS,
        grid: { stroke: COLOR_GRID },
        ticks: { stroke: COLOR_GRID }
      }
    ],
    series: [
      {},
      ...labels.map((label, index) => ({
        label,
        stroke: colorFor(index),
        width: 2,
        spanGaps: false,
        points: { show: false }
      }))
    ],
    legend: { show: true },
    // Drag-select on the x-axis zooms into that range (uPlot's built-in
    // cursor.drag.setScale, on by default) - `TimeRangeControls`' "Reset
    // zoom" button (`fitToRange`) is the way back out.
    cursor: { drag: { x: true, y: false } },
    hooks: {
      setScale: [
        (u, key) => {
          if (key !== 'x') return
          const { min, max } = u.scales.x
          if (min == null || max == null) return
          onXScaleChange(min, max)
        }
      ],
      // Recompute marker pixel positions only after uPlot has actually
      // finished a redraw - reading valToPos() any earlier (e.g. right after
      // calling setData/redraw) can see stale scale bounds, since the real
      // scale recalculation happens inside uPlot's own deferred commit.
      draw: [onDraw]
    }
  }
}

/**
 * One chart, every target overlaid as its own colored line (latency) -
 * hovering shows each target's value at that time via uPlot's built-in
 * cursor-synced legend, labeled with the target's name and IP so you don't
 * need to cross-reference the sidebar to know which line is which.
 */
function OverviewChart({ targets, updatesByTarget }: OverviewChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [rangeMs, setRangeMs] = useState(DEFAULT_RANGE_MS)
  const [viewMode, setViewMode] = useState<ViewMode>('combined')

  // The applied cadence (seconds) and the raw text of the input - kept
  // separate so an in-progress edit (e.g. a cleared field, or "2.") isn't
  // clobbered by re-renders before the user commits it.
  const [pingIntervalSec, setPingIntervalSec] = useState<number | null>(null)
  const [pingIntervalInput, setPingIntervalInput] = useState('')
  const [isSavingInterval, setIsSavingInterval] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      const seconds = settings.pingIntervalMs / 1000
      setPingIntervalSec(seconds)
      setPingIntervalInput(String(seconds))
    })
  }, [])

  const commitPingInterval = (): void => {
    const seconds = Number(pingIntervalInput)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      // Invalid edit - revert the field to the last known-applied value.
      setPingIntervalInput(pingIntervalSec !== null ? String(pingIntervalSec) : '')
      return
    }
    setIsSavingInterval(true)
    window.api
      .setPingIntervalMs(seconds * 1000)
      .then((settings) => {
        const appliedSeconds = settings.pingIntervalMs / 1000
        setPingIntervalSec(appliedSeconds)
        setPingIntervalInput(String(appliedSeconds))
      })
      .finally(() => setIsSavingInterval(false))
  }
  // Tracks unchecked targets rather than checked ones, so a newly added
  // target defaults to visible without needing its id added explicitly.
  const [excludedTargetIds, setExcludedTargetIds] = useState<Set<string>>(new Set())
  const [isCombinedZoomed, setIsCombinedZoomed] = useState(false)
  // Read inside the combined chart's setScale hook, which closes over the
  // plot instance created once on mount - a ref keeps it seeing the latest
  // selected range without recreating the plot every time it changes.
  const rangeMsRef = useRef(rangeMs)
  useEffect(() => {
    rangeMsRef.current = rangeMs
  }, [rangeMs])

  // Individual view: each target has its own uPlot instance and its own
  // drag-zoom state, so a single target being zoomed doesn't tell the whole
  // story - this tracks which of the currently-checked targets are zoomed,
  // and `resetToken` is how the shared "Reset zoom" button reaches all of
  // them at once (each chart re-fits whenever it sees a new token).
  const [zoomedTargetIds, setZoomedTargetIds] = useState<Set<string>>(new Set())
  const [resetToken, setResetToken] = useState(0)

  const handleIndividualZoomChange = useCallback((targetId: string, isZoomed: boolean): void => {
    setZoomedTargetIds((prev) => {
      const wasZoomed = prev.has(targetId)
      if (wasZoomed === isZoomed) return prev
      const next = new Set(prev)
      if (isZoomed) next.add(targetId)
      else next.delete(targetId)
      return next
    })
  }, [])

  const toggleTarget = (id: string): void => {
    setExcludedTargetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleTargets = useMemo(
    () => targets.filter((target) => !excludedTargetIds.has(target.id)),
    [targets, excludedTargetIds]
  )

  const overviewData = useMemo(
    () => buildOverviewChartData(targets, updatesByTarget, rangeMs),
    [targets, updatesByTarget, rangeMs]
  )
  const { xs, series } = overviewData

  const anomaliesByTarget = useMemo(() => detectPacketLossAnomalies(xs, series), [xs, series])

  const labelByTargetId = useMemo(() => new Map(series.map((s) => [s.targetId, s.label])), [series])
  const labelByTargetIdRef = useRef(labelByTargetId)
  useEffect(() => {
    labelByTargetIdRef.current = labelByTargetId
  }, [labelByTargetId])

  const combinedAnomalies = useMemo(
    () => Array.from(anomaliesByTarget.values()).flat(),
    [anomaliesByTarget]
  )
  // Read inside the combined chart's `draw` hook, which closes over the plot
  // instance created once on mount - a ref keeps it seeing the latest
  // anomalies without recreating the plot on every data tick.
  const combinedAnomaliesRef = useRef<PacketLossAnomaly[]>(combinedAnomalies)
  useEffect(() => {
    combinedAnomaliesRef.current = combinedAnomalies
  }, [combinedAnomalies])

  const [combinedMarkers, setCombinedMarkers] = useState<AnomalyMarker[]>([])

  const recomputeCombinedMarkers = (u: uPlot): void => {
    const { min: xMin, max: xMax } = u.scales.x
    const { left, top } = plotOffsetCss(u)
    const next = combinedAnomaliesRef.current
      .filter(
        (a) => xMin == null || xMax == null || (a.timestampSec >= xMin && a.timestampSec <= xMax)
      )
      .map((a) => ({
        key: anomalyMarkerKey(a.targetId, a.index),
        left: left + u.valToPos(a.timestampSec, 'x', false),
        top: top + ANOMALY_RAIL_OFFSET,
        targetLabel: labelByTargetIdRef.current.get(a.targetId) ?? a.targetId,
        timestampSec: a.timestampSec,
        lossPercent: a.lossPercent,
        othersAvgLossPercent: a.othersAvgLossPercent,
        latencyMs: a.latencyMs
      }))
    setCombinedMarkers(next)
  }

  // Ignores stale entries for targets that got unchecked since - no
  // explicit cleanup needed when a chart unmounts.
  const anyIndividualZoomed = visibleTargets.some((target) => zoomedTargetIds.has(target.id))

  // Rebuild only when the SET of targets changes (series count/labels/
  // colors depend on it) - not on every ~1s data tick.
  const targetsKey = useMemo(() => targets.map((target) => target.id).join(','), [targets])

  useEffect(() => {
    const container = containerRef.current
    if (!container || targets.length === 0 || viewMode !== 'combined') return

    const labels = targets.map((target) => `${target.name} (${target.host})`)
    const { width, height } = container.getBoundingClientRect()
    const initialData: uPlot.AlignedData = [[], ...targets.map(() => [])] as uPlot.AlignedData
    const plot = new uPlot(
      buildOptions(
        Math.max(width, 1),
        Math.max(height, 1),
        labels,
        (min, max) => {
          const fullSpanSec = rangeMsRef.current / 1000
          setIsCombinedZoomed(max - min < fullSpanSec - 1)
        },
        (u) => recomputeCombinedMarkers(u)
      ),
      initialData,
      container
    )
    plotRef.current = plot

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width: w, height: h } = entry.contentRect
      // uPlot's setSize() unconditionally forces a full path rebuild + redraw
      // even when the size hasn't actually changed - ResizeObserver can fire
      // with a no-op (sub-pixel) size report, so skip the call rather than
      // pay for a needless full redraw.
      if (w > 0 && h > 0 && (Math.abs(plot.width - w) >= 0.5 || Math.abs(plot.height - h) >= 0.5)) {
        plot.setSize({ width: w, height: h })
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      plot.destroy()
      plotRef.current = null
      setIsCombinedZoomed(false)
      setCombinedMarkers([])
    }
    // Deliberately keyed on targetsKey, not `targets` itself - see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, viewMode])

  useEffect(() => {
    if (viewMode !== 'combined') return
    const plot = plotRef.current
    if (!plot) return
    // setData's own resetScales:false path skips uPlot's internal commit()
    // entirely - so without an explicit redraw() below, the canvas simply
    // never repaints on a plain data tick, and the picture only updates in
    // one big jump whenever some unrelated layout reflow happens to fire the
    // ResizeObserver above. redraw() (rebuildPaths defaults true) reapplies
    // the plot's CURRENT x-scale bounds - preserving a manual drag-zoom
    // instead of re-fitting to the full data range - while still forcing the
    // repaint, so every ~1s tick lands as its own smooth, immediate update
    // (which in turn fires the `draw` hook that recomputes marker positions).
    plot.setData([xs, ...series.map((s) => s.latency)], false)
    plot.redraw()
  }, [xs, series, viewMode])

  const fitToRange = (): void => {
    const plot = plotRef.current
    if (!plot) return
    const now = Date.now()
    plot.setScale('x', { min: Math.floor((now - rangeMs) / 1000), max: Math.floor(now / 1000) })
  }

  // Re-fit whenever the selected preset (or the target set, which rebuilds
  // the plot instance above) changes - not on every data tick.
  useEffect(fitToRange, [rangeMs, targetsKey, viewMode])

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>Overview</h1>
        <div className="ping-interval-setting">
          <label htmlFor="ping-interval-input">Ping interval (s)</label>
          <input
            id="ping-interval-input"
            type="number"
            min={0.2}
            step={0.5}
            value={pingIntervalInput}
            disabled={pingIntervalSec === null || isSavingInterval}
            onChange={(event) => setPingIntervalInput(event.target.value)}
            onBlur={commitPingInterval}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commitPingInterval()
              event.currentTarget.blur()
            }}
          />
        </div>
        <div className="view-mode-toggle">
          <button
            type="button"
            className={`view-mode-btn ${viewMode === 'combined' ? 'view-mode-btn--active' : ''}`}
            onClick={() => setViewMode('combined')}
          >
            All targets
          </button>
          <button
            type="button"
            className={`view-mode-btn ${viewMode === 'individual' ? 'view-mode-btn--active' : ''}`}
            onClick={() => setViewMode('individual')}
          >
            Individual
          </button>
        </div>
      </header>

      {viewMode === 'individual' && targets.length > 0 && (
        <div className="target-checkbox-list">
          {targets.map((target) => (
            <label key={target.id} className="target-checkbox">
              <input
                type="checkbox"
                checked={!excludedTargetIds.has(target.id)}
                onChange={() => toggleTarget(target.id)}
              />
              <span>
                {target.name} ({target.host})
              </span>
            </label>
          ))}
        </div>
      )}

      {viewMode === 'combined' ? (
        <section className="feed">
          <div className="feed-header-row">
            <h2>All Targets - Latency</h2>
            {targets.length > 0 && (
              <TimeRangeControls
                rangeMs={rangeMs}
                onSelectRange={setRangeMs}
                onResetZoom={fitToRange}
                isZoomed={isCombinedZoomed}
              />
            )}
          </div>
          {targets.length === 0 ? (
            <p className="feed-empty">Add a target to see its latency here.</p>
          ) : (
            <div className="chart-wrap">
              <div
                ref={containerRef}
                className={`timeline-chart overview-chart ${isCombinedZoomed ? 'timeline-chart--zoomed' : ''}`}
              />
              <ChartAnomalyOverlay markers={combinedMarkers} />
            </div>
          )}
        </section>
      ) : (
        <>
          {targets.length > 0 && (
            <div className="feed-header-row individual-charts-header">
              <h2>Latency by target</h2>
              <TimeRangeControls
                rangeMs={rangeMs}
                onSelectRange={setRangeMs}
                onResetZoom={() => setResetToken((token) => token + 1)}
                isZoomed={anyIndividualZoomed}
              />
            </div>
          )}
          {targets.length === 0 ? (
            <section className="feed">
              <p className="feed-empty">Add a target to see its latency here.</p>
            </section>
          ) : visibleTargets.length === 0 ? (
            <section className="feed">
              <p className="feed-empty">Check a target above to see its latency.</p>
            </section>
          ) : (
            visibleTargets.map((target) => (
              <section className="feed feed--compact" key={target.id}>
                <div className="feed-header-row">
                  <h2>
                    {target.name} ({target.host})
                  </h2>
                </div>
                <IndividualLatencyChart
                  targetId={target.id}
                  targetName={target.name}
                  targetHost={target.host}
                  updates={updatesByTarget[target.id] ?? []}
                  rangeMs={rangeMs}
                  color={colorFor(targets.findIndex((t) => t.id === target.id))}
                  resetSignal={resetToken}
                  onZoomChange={handleIndividualZoomChange}
                  anomalies={anomaliesByTarget.get(target.id) ?? []}
                />
              </section>
            ))
          )}
        </>
      )}
    </main>
  )
}

export default OverviewChart
