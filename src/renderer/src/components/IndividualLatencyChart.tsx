import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import type { NetworkUpdate, PingHistoryRecord } from '../../../shared/types'
import { buildOverviewChartData } from '../lib/overview-chart'
import { buildPingHistorySeries } from '../lib/ping-history-chart'
import { TIMELINE_RANGE_PRESETS } from '../lib/chart-data'
import { drawLossMarkers } from '../lib/chart-loss-markers'
import type { PacketLossAnomaly } from '../lib/packet-loss-anomaly'
import { plotOffsetCss } from '../lib/uplot-position'
import ChartAnomalyOverlay, { type AnomalyMarker } from './ChartAnomalyOverlay'

// While a history-backed range (24h/7d/30d) is selected, re-fetch on this
// cadence so the chart still advances roughly in step with the engine's own
// 1-minute rollup flush, without needing a manual refresh button - mirrors
// `TimelineChart`'s identical constant.
const HISTORY_REFRESH_MS = 60_000

/** How far below the plot's top edge the anomaly-marker rail sits, in CSS px. */
const ANOMALY_RAIL_OFFSET = 10

/** The x-axis range one individual chart's drag-zoom produced, broadcast to the rest. */
export interface SyncedZoomRange {
  min: number
  max: number
  /** targetId of the chart that produced this range - it skips re-applying its own broadcast. */
  sourceId: string
}

interface IndividualLatencyChartProps {
  targetId: string
  targetName: string
  targetHost: string
  updates: NetworkUpdate[]
  rangeMs: number
  /** Current global ping cadence - see `buildOverviewChartData` for why the chart grid must track it. */
  pingIntervalMs: number
  color: string
  /** Bumped by the parent's shared "Reset zoom" button to re-fit this chart too. */
  resetSignal: number
  onZoomChange: (targetId: string, isZoomed: boolean, min: number, max: number) => void
  /** Latest drag-zoom range from any individual chart (including this one) - applied to all but the source. */
  syncedRange: SyncedZoomRange | null
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
  pingIntervalMs,
  color,
  resetSignal,
  onZoomChange,
  syncedRange,
  anomalies
}: IndividualLatencyChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [isZoomed, setIsZoomed] = useState(false)
  const [historyRecords, setHistoryRecords] = useState<PingHistoryRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)

  // `rangeMs` comes from OverviewChart's one shared range picker, applied
  // identically to every individual chart - so this chart's own source
  // (live buffer vs DB history) tracks the SAME preset every other chart in
  // the list is using, just fetched independently per target.
  const selectedPreset = useMemo(
    () =>
      TIMELINE_RANGE_PRESETS.find((preset) => preset.ms === rangeMs) ?? TIMELINE_RANGE_PRESETS[0],
    [rangeMs]
  )

  // Read inside the setScale hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest selected range
  // without recreating the plot every time it changes.
  const rangeMsRef = useRef(rangeMs)
  useEffect(() => {
    rangeMsRef.current = rangeMs
  }, [rangeMs])

  // Read inside the setScale hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest callback without
  // recreating the plot every time the parent re-renders.
  const onZoomChangeRef = useRef(onZoomChange)
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange
  }, [onZoomChange])

  // True while this chart is applying a range that another chart broadcast -
  // suppresses re-broadcasting that same change back out, which would
  // otherwise ping-pong the range between every open chart forever.
  const isSyncingRef = useRef(false)

  const targetLabel = `${targetName} (${targetHost})`
  // Read inside the draw hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest anomaly list
  // without recreating the plot on every data tick.
  const anomaliesRef = useRef(anomalies)
  useEffect(() => {
    anomaliesRef.current = anomalies
  }, [anomalies])

  const [markers, setMarkers] = useState<AnomalyMarker[]>([])

  // Read inside the draw hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest set of lost-
  // ping timestamps without recreating the plot on every data tick.
  const lostSecondsRef = useRef<number[]>([])

  const recomputeMarkers = (u: uPlot): void => {
    const { min: xMin, max: xMax } = u.scales.x
    const { left, top } = plotOffsetCss(u)
    const next = anomaliesRef.current
      .filter(
        (a) => xMin == null || xMax == null || (a.timestampSec >= xMin && a.timestampSec <= xMax)
      )
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
          const zoomed = max - min < fullSpanSec - 1
          setIsZoomed(zoomed)
          if (!isSyncingRef.current) {
            onZoomChangeRef.current(targetId, zoomed, min, max)
          }
        },
        (u) => {
          recomputeMarkers(u)
          drawLossMarkers(u, lostSecondsRef.current)
        }
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

  // Read inside the data-tick effect below, which must know whether the user
  // currently has a manual drag-zoom active without re-running (and thus
  // re-subscribing) on every isZoomed flip.
  const isZoomedRef = useRef(isZoomed)
  useEffect(() => {
    isZoomedRef.current = isZoomed
  }, [isZoomed])

  const fitToRange = (): void => {
    const plot = plotRef.current
    if (!plot) return
    const now = Date.now()
    plot.setScale('x', { min: Math.floor((now - rangeMs) / 1000), max: Math.floor(now / 1000) })
  }

  // History-backed presets (24h/7d/30d) fetch this target's rollups from the
  // DB instead of reading `updates` - re-fetches on a plain timer while
  // active, since there's no live push channel for rollups the way there is
  // for samples (mirrors `TimelineChart`'s identical effect).
  useEffect(() => {
    if (selectedPreset.source !== 'history') return

    let cancelled = false
    const load = (): void => {
      setHistoryError(null)
      const to = new Date()
      const from = new Date(to.getTime() - selectedPreset.ms)
      window.api
        .getPingHistory({ targetId, from, to })
        .then((records) => {
          if (!cancelled) setHistoryRecords(records)
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setHistoryError(error instanceof Error ? error.message : 'Failed to load ping history')
          }
        })
    }

    load()
    const interval = setInterval(load, HISTORY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [targetId, selectedPreset])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return

    let xs: number[]
    let latency: (number | null)[]

    if (selectedPreset.source === 'history') {
      const series = buildPingHistorySeries(historyRecords)
      xs = series.xs
      latency = series.avgLatency
      lostSecondsRef.current = series.lostBucketSeconds
    } else {
      const built = buildOverviewChartData(
        [{ id: targetId, name: targetName, host: targetHost }],
        { [targetId]: updates },
        rangeMs,
        pingIntervalMs
      )
      xs = built.xs
      latency = built.series[0]?.latency ?? []
      lostSecondsRef.current = xs.filter((_, index) => latency[index] === null)
    }

    // setData's own resetScales:false path skips uPlot's internal commit()
    // entirely - so without an explicit redraw()/setScale() below, the
    // canvas simply never repaints on a plain data tick, and the picture
    // only updates in one big jump whenever some unrelated layout reflow
    // happens to fire the ResizeObserver above.
    plot.setData([xs, latency], false)
    if (isZoomedRef.current) {
      // A manual drag-zoom is active - redraw() (rebuildPaths defaults true)
      // reapplies the plot's CURRENT x-scale bounds, preserving that zoom
      // instead of re-fitting to the full data range, while still forcing
      // the repaint.
      plot.redraw()
    } else {
      // Unzoomed: the live-mode bucket window above is a rolling
      // [now - rangeMs, now] range that slides forward every tick, but a
      // plain redraw() would keep showing the OLD bounds from the last
      // fitToRange() call - as the two windows drift apart, buckets that
      // fell out of the new window simply vanish, which looks like the
      // line eroding away from its left edge. Re-fitting here keeps the
      // view following the current time, the way a live chart should.
      fitToRange()
    }
  }, [
    selectedPreset,
    targetId,
    targetName,
    targetHost,
    updates,
    historyRecords,
    rangeMs,
    pingIntervalMs
  ])

  // Re-fit on a new range preset, or when the parent's shared "Reset zoom"
  // button bumps resetSignal - not on every data tick.
  useEffect(fitToRange, [rangeMs, targetId, resetSignal])

  // Mirror another chart's drag-zoom onto this one, so selecting a range in
  // any individual graph zooms all of them together. Skips self - this
  // chart's own drag already has the range applied by uPlot's cursor drag.
  useEffect(() => {
    const plot = plotRef.current
    if (!plot || !syncedRange || syncedRange.sourceId === targetId) return
    isSyncingRef.current = true
    plot.setScale('x', { min: syncedRange.min, max: syncedRange.max })
    isSyncingRef.current = false
  }, [syncedRange, targetId])

  return (
    <div className="chart-wrap">
      {selectedPreset.source === 'history' && historyError && (
        <p className="sidebar-error">{historyError}</p>
      )}
      <div
        ref={containerRef}
        className={`timeline-chart overview-chart overview-chart--individual ${isZoomed ? 'timeline-chart--zoomed' : ''}`}
      />
      <ChartAnomalyOverlay markers={markers} />
    </div>
  )
}

export default IndividualLatencyChart
