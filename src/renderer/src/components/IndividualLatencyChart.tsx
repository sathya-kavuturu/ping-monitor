import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import type { NetworkUpdate } from '../../../shared/types'
import { buildOverviewChartData } from '../lib/overview-chart'
import type { PacketLossAnomaly } from '../lib/packet-loss-anomaly'
import { plotOffsetCss } from '../lib/uplot-position'
import ChartAnomalyOverlay, { type AnomalyMarker } from './ChartAnomalyOverlay'

/** How far below the plot's top edge the anomaly-marker rail sits, in CSS px. */
const ANOMALY_RAIL_OFFSET = 10

interface IndividualLatencyChartProps {
  targetId: string
  targetName: string
  targetHost: string
  updates: NetworkUpdate[]
  rangeMs: number
  color: string
  /** Bumped by the parent's shared "Reset zoom" button to re-fit this chart too. */
  resetSignal: number
  onZoomChange: (targetId: string, isZoomed: boolean) => void
  /** This target's cross-target packet-loss outliers - see `detectPacketLossAnomalies`. */
  anomalies: PacketLossAnomaly[]
}

const COLOR_AXIS = '#8b91a2'
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)'

function buildOptions(
  width: number,
  height: number,
  label: string,
  color: string,
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
    series: [{}, { label, stroke: color, width: 2, spanGaps: false, points: { show: false } }],
    legend: { show: true },
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

function anomalyMarkerKey(targetId: string, index: number): string {
  return `${targetId}-${index}`
}

/**
 * One target's own uPlot instance - used by `OverviewChart`'s "individual
 * graphs" view, where each checked target gets its own stacked chart instead
 * of all of them overlaid on one. Reuses `buildOverviewChartData` (fed a
 * single-target array) so the x-axis bucketing matches the combined view
 * exactly.
 */
function IndividualLatencyChart({
  targetId,
  targetName,
  targetHost,
  updates,
  rangeMs,
  color,
  resetSignal,
  onZoomChange,
  anomalies
}: IndividualLatencyChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [isZoomed, setIsZoomed] = useState(false)
  // Read inside the setScale hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest selected range
  // without recreating the plot every time it changes.
  const rangeMsRef = useRef(rangeMs)
  useEffect(() => {
    rangeMsRef.current = rangeMs
  }, [rangeMs])

  useEffect(() => {
    onZoomChange(targetId, isZoomed)
  }, [targetId, isZoomed, onZoomChange])

  const targetLabel = `${targetName} (${targetHost})`
  // Read inside the draw hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest anomaly list
  // without recreating the plot on every data tick.
  const anomaliesRef = useRef(anomalies)
  useEffect(() => {
    anomaliesRef.current = anomalies
  }, [anomalies])

  const [markers, setMarkers] = useState<AnomalyMarker[]>([])

  const recomputeMarkers = (u: uPlot): void => {
    const { min: xMin, max: xMax } = u.scales.x
    const { left, top } = plotOffsetCss(u)
    const next = anomaliesRef.current
      .filter((a) => xMin == null || xMax == null || (a.timestampSec >= xMin && a.timestampSec <= xMax))
      .map((a) => ({
        key: anomalyMarkerKey(a.targetId, a.index),
        left: left + u.valToPos(a.timestampSec, 'x', false),
        top: top + ANOMALY_RAIL_OFFSET,
        targetLabel,
        timestampSec: a.timestampSec,
        lossPercent: a.lossPercent,
        othersAvgLossPercent: a.othersAvgLossPercent,
        latencyMs: a.latencyMs
      }))
    setMarkers(next)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    const plot = new uPlot(
      buildOptions(
        Math.max(width, 1),
        Math.max(height, 1),
        `${targetName} (${targetHost})`,
        color,
        (min, max) => {
          const fullSpanSec = rangeMsRef.current / 1000
          setIsZoomed(max - min < fullSpanSec - 1)
        },
        (u) => recomputeMarkers(u)
      ),
      [[], []],
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
      setMarkers([])
    }
    // Rebuild only on identity/label/color change - not on every data tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, targetName, targetHost, color])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const { xs, series } = buildOverviewChartData(
      [{ id: targetId, name: targetName, host: targetHost }],
      { [targetId]: updates },
      rangeMs
    )
    // setData's own resetScales:false path skips uPlot's internal commit()
    // entirely - so without an explicit redraw() below, the canvas simply
    // never repaints on a plain data tick, and the picture only updates in
    // one big jump whenever some unrelated layout reflow happens to fire the
    // ResizeObserver above. redraw() (rebuildPaths defaults true) reapplies
    // the plot's CURRENT x-scale bounds - preserving a manual drag-zoom
    // instead of re-fitting to the full data range - while still forcing the
    // repaint, so every ~1s tick lands as its own smooth, immediate update.
    plot.setData([xs, series[0]?.latency ?? []], false)
    plot.redraw()
  }, [targetId, targetName, targetHost, updates, rangeMs])

  const fitToRange = (): void => {
    const plot = plotRef.current
    if (!plot) return
    const now = Date.now()
    plot.setScale('x', { min: Math.floor((now - rangeMs) / 1000), max: Math.floor(now / 1000) })
  }

  // Re-fit on a new range preset, or when the parent's shared "Reset zoom"
  // button bumps resetSignal - not on every data tick.
  useEffect(fitToRange, [rangeMs, targetId, resetSignal])

  return (
    <div className="chart-wrap">
      <div
        ref={containerRef}
        className={`timeline-chart overview-chart ${isZoomed ? 'timeline-chart--zoomed' : ''}`}
      />
      <ChartAnomalyOverlay markers={markers} />
    </div>
  )
}

export default IndividualLatencyChart
