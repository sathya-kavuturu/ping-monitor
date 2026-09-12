import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { NetworkUpdate, PingHistoryRecord } from '../../../shared/types'
import { buildChartSeries, TIMELINE_RANGE_PRESETS } from '../lib/chart-data'
import { buildPingHistorySeries } from '../lib/ping-history-chart'
import { drawLossMarkers } from '../lib/chart-loss-markers'
import { formatLegendTimestamp } from '../lib/chart-legend'
import TimeRangeControls from './TimeRangeControls'

/** An explicit, bounded timeframe the chart is currently showing - `null` means "the live default" (unzoomed, short preset). */
export interface VisibleTimeRange {
  fromMs: number
  toMs: number
}

interface TimelineChartProps {
  targetId: string
  updates: NetworkUpdate[]
  /**
   * Reports the timeframe the Network Path/Route Table below should show
   * hops for - `null` while unzoomed on a short live preset (those views
   * fall back to the live buffer's own latest runs), and a concrete
   * `{fromMs, toMs}` once a history preset (24h/7d/30d) or a manual
   * drag-zoom pins down an explicit window, so the path shown matches
   * whatever timeframe is actually selected here.
   */
  onExplicitRangeChange?: (range: VisibleTimeRange | null) => void
}

const COLOR_LATENCY = '#4f8cff'
const COLOR_AXIS = '#8b91a2'
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)'

// While a history-backed range (24h/7d/30d) is selected, re-fetch on this
// cadence so the chart still advances roughly in step with the engine's
// own 1-minute rollup flush, without needing a manual refresh button.
const HISTORY_REFRESH_MS = 60_000

function buildOptions(
  width: number,
  height: number,
  onXScaleChange: (min: number, max: number) => void,
  onDraw: (u: uPlot) => void
): uPlot.Options {
  return {
    width,
    height,
    padding: [12, 12, 0, 0],
    scales: {
      x: { time: true },
      y: {
        range: (_self, _min, max) => [0, Math.max(50, max * 1.2)]
      }
    },
    axes: [
      {
        stroke: COLOR_AXIS,
        grid: { stroke: COLOR_GRID },
        ticks: { stroke: COLOR_GRID }
      },
      {
        scale: 'y',
        label: 'Latency (ms)',
        stroke: COLOR_AXIS,
        grid: { stroke: COLOR_GRID },
        ticks: { stroke: COLOR_GRID }
      }
    ],
    series: [
      { value: formatLegendTimestamp },
      {
        label: 'Latency',
        scale: 'y',
        stroke: COLOR_LATENCY,
        width: 2,
        // Spanning gaps (rather than breaking the line at a lost/null
        // sample) means the line runs right up to a loss marker instead of
        // leaving a blank sliver on either side of it - see `drawLossMarkers`.
        spanGaps: true,
        points: { show: false }
      }
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
      // Fires after uPlot has finished its own draw pass for the frame, so
      // drawing directly on `u.ctx` here layers cleanly on top of the
      // already-rendered latency line instead of getting overwritten by it.
      draw: [onDraw]
    }
  }
}

/**
 * Thin React wrapper around uPlot (canvas-based, not React-native) - create
 * the instance once, then push new data/size into it imperatively via
 * `setData`/`setSize` rather than re-rendering the DOM every tick. That's
 * what makes it viable to redraw on every ~1s sample without jank.
 *
 * One chart, two data sources depending on the selected range (see
 * `TIMELINE_RANGE_PRESETS`): short presets slice the live in-memory buffer
 * (`updates`), long ones fetch durable 1-minute rollups from the DB
 * (`getPingHistory`) - this used to be two separate charts ("Latency &
 * Packet Loss" and "Ping History"), merged into one so switching between
 * "how far back am I looking" doesn't mean switching sections of the page.
 *
 * There's no packet-loss line/scale anymore - instead, every lost ping (a
 * `null` latency sample, or a rollup bucket with `lostCount > 0`) draws as a
 * thin red vertical bar across the full chart height (see
 * `drawLossMarkers`, shared with the Overview tab's charts), a much
 * harder-to-miss signal than a smoothed percentage line, especially for an
 * isolated single lost ping.
 */
function TimelineChart({
  targetId,
  updates,
  onExplicitRangeChange
}: TimelineChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [rangeMs, setRangeMs] = useState(TIMELINE_RANGE_PRESETS[0].ms)
  const [isZoomed, setIsZoomed] = useState(false)
  const [historyRecords, setHistoryRecords] = useState<PingHistoryRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)

  // The plot's current visible x-scale bounds (seconds) - updated
  // synchronously from the setScale hook below, alongside `isZoomed`, so the
  // explicit-range effect further down always reads the bounds that go with
  // whatever `isZoomed`/`selectedPreset` it's reacting to.
  const visibleBoundsRef = useRef<{ min: number; max: number } | null>(null)

  const selectedPreset = useMemo(
    () =>
      TIMELINE_RANGE_PRESETS.find((preset) => preset.ms === rangeMs) ?? TIMELINE_RANGE_PRESETS[0],
    [rangeMs]
  )

  // Read inside the setScale hook below, which closes over the plot
  // instance created once on mount - a ref keeps it seeing the latest
  // selected range without recreating the plot every time it changes.
  const rangeMsRef = useRef(rangeMs)
  useEffect(() => {
    rangeMsRef.current = rangeMs
  }, [rangeMs])

  // Read inside the draw hook below, which closes over the plot instance
  // created once on mount - a ref keeps it seeing the latest set of lost-
  // ping timestamps without recreating the plot on every data tick.
  const lostSecondsRef = useRef<number[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { width, height } = container.getBoundingClientRect()
    const plot = new uPlot(
      buildOptions(
        Math.max(width, 1),
        Math.max(height, 1),
        (min, max) => {
          visibleBoundsRef.current = { min, max }
          // A manual drag-zoom shrinks the visible span below the selected
          // preset's full width - that's the only way `isZoomed` flips true,
          // so an explicit fitToRange() (which restores the full span) always
          // clears it again.
          const fullSpanSec = rangeMsRef.current / 1000
          setIsZoomed(max - min < fullSpanSec - 1)
        },
        (u) => drawLossMarkers(u, lostSecondsRef.current)
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Read inside the data-tick effect below, which must know whether the user
  // currently has a manual drag-zoom active without re-running (and thus
  // re-subscribing) on every isZoomed flip.
  const isZoomedRef = useRef(isZoomed)
  useEffect(() => {
    isZoomedRef.current = isZoomed
  }, [isZoomed])

  // Reports the explicit timeframe (see `onExplicitRangeChange`'s doc
  // comment) whenever the preset or zoom state changes - deliberately NOT
  // keyed on every live-mode tick (which also nudges the plot's bounds
  // forward every ~1s via `fitToRange`), so a live, unzoomed short preset
  // doesn't cause a DB fetch every second in the parent.
  useEffect(() => {
    if (!onExplicitRangeChange) return
    const bounds = visibleBoundsRef.current
    if (selectedPreset.source === 'history') {
      onExplicitRangeChange(
        bounds
          ? { fromMs: bounds.min * 1000, toMs: bounds.max * 1000 }
          : { fromMs: Date.now() - rangeMs, toMs: Date.now() }
      )
    } else if (isZoomed && bounds) {
      onExplicitRangeChange({ fromMs: bounds.min * 1000, toMs: bounds.max * 1000 })
    } else {
      onExplicitRangeChange(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset, isZoomed])

  const fitToRange = (): void => {
    const plot = plotRef.current
    if (!plot) return
    const now = Date.now()
    plot.setScale('x', { min: Math.floor((now - rangeMs) / 1000), max: Math.floor(now / 1000) })
  }

  // History-backed presets (24h/7d/30d) fetch from the DB instead of
  // reading `updates` - re-fetches on a plain timer while active, since
  // there's no live push channel for rollups the way there is for samples.
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
      // Keeps the reported explicit range creeping forward with "now" on
      // the same cadence as the rollup refetch above, so the Network
      // Path/Route Table stay current for an unzoomed history preset
      // instead of freezing at whatever moment it was first selected. A
      // manual drag-zoom (isZoomedRef true) pins an explicit sub-window on
      // purpose, so it's left alone here - the dedicated effect above
      // already reported it once when the zoom was made.
      if (onExplicitRangeChange && !isZoomedRef.current) {
        onExplicitRangeChange({ fromMs: from.getTime(), toMs: to.getTime() })
      }
    }

    load()
    const interval = setInterval(load, HISTORY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // onExplicitRangeChange is a stable setState-style callback from the
    // parent, and isZoomedRef is a ref - neither needs to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const cutoff = Date.now() - rangeMs
      const inRange = updates.filter((update) => update.timestamp >= cutoff)
      const series = buildChartSeries(inRange)
      xs = series.xs
      latency = series.latency
      lostSecondsRef.current = series.xs.filter((_, index) => series.latency[index] === null)
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
      // Unzoomed: the live-mode cutoff above is a rolling [now - rangeMs,
      // now] window that slides forward every tick, but a plain redraw()
      // would keep showing the OLD bounds from the last fitToRange() call -
      // as the two windows drift apart, samples that fell out of the new
      // window simply vanish, which looks like the line eroding away from
      // its left edge. Re-fitting here keeps the view following the current
      // time, the way a live chart should (history mode re-fits too, purely
      // for consistency - its window is already exactly [now - rangeMs, now]
      // by construction).
      fitToRange()
    }
  }, [selectedPreset, updates, historyRecords, rangeMs])

  // Re-fit whenever the selected preset changes (not on every data tick).
  useEffect(fitToRange, [rangeMs])

  return (
    <section className="feed">
      <div className="feed-header-row">
        <h2>Latency</h2>
        <TimeRangeControls
          rangeMs={rangeMs}
          onSelectRange={setRangeMs}
          onResetZoom={fitToRange}
          isZoomed={isZoomed}
          presets={TIMELINE_RANGE_PRESETS}
        />
      </div>
      {selectedPreset.source === 'history' && historyError && (
        <p className="sidebar-error">{historyError}</p>
      )}
      <div
        ref={containerRef}
        className={`timeline-chart ${isZoomed ? 'timeline-chart--zoomed' : ''}`}
      />
    </section>
  )
}

export default TimelineChart
