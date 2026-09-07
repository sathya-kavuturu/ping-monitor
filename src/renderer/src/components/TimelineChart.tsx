import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { NetworkUpdate } from '../../../shared/types'
import { buildChartSeries } from '../lib/chart-data'
import { DEFAULT_RANGE_MS } from '../lib/chart-data'
import TimeRangeControls from './TimeRangeControls'

interface TimelineChartProps {
  updates: NetworkUpdate[]
}

const COLOR_LATENCY = '#4f8cff'
const COLOR_LOSS = '#e6543e'
const COLOR_AXIS = '#8b91a2'
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)'

function buildOptions(
  width: number,
  height: number,
  onXScaleChange: (min: number, max: number) => void
): uPlot.Options {
  return {
    width,
    height,
    padding: [12, 12, 0, 0],
    scales: {
      x: { time: true },
      y: {
        range: (_self, _min, max) => [0, Math.max(50, max * 1.2)]
      },
      loss: { range: [0, 100] }
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
      },
      {
        scale: 'loss',
        label: 'Packet loss (%)',
        side: 1,
        stroke: COLOR_AXIS,
        grid: { show: false },
        ticks: { stroke: COLOR_GRID }
      }
    ],
    series: [
      {},
      {
        label: 'Latency',
        scale: 'y',
        stroke: COLOR_LATENCY,
        width: 2,
        spanGaps: false,
        points: { show: false }
      },
      {
        label: 'Packet loss',
        scale: 'loss',
        stroke: COLOR_LOSS,
        fill: 'rgba(230, 84, 62, 0.15)',
        width: 1,
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
      ]
    }
  }
}

/**
 * Thin React wrapper around uPlot (canvas-based, not React-native) - create
 * the instance once, then push new data/size into it imperatively via
 * `setData`/`setSize` rather than re-rendering the DOM every tick. That's
 * what makes it viable to redraw on every ~1s sample without jank.
 */
function TimelineChart({ updates }: TimelineChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [rangeMs, setRangeMs] = useState(DEFAULT_RANGE_MS)
  const [isZoomed, setIsZoomed] = useState(false)
  // Read inside the setScale hook below, which closes over the plot
  // instance created once on mount - a ref keeps it seeing the latest
  // selected range without recreating the plot every time it changes.
  const rangeMsRef = useRef(rangeMs)
  useEffect(() => {
    rangeMsRef.current = rangeMs
  }, [rangeMs])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { width, height } = container.getBoundingClientRect()
    const plot = new uPlot(
      buildOptions(Math.max(width, 1), Math.max(height, 1), (min, max) => {
        // A manual drag-zoom shrinks the visible span below the selected
        // preset's full width - that's the only way `isZoomed` flips true,
        // so an explicit fitToRange() (which restores the full span) always
        // clears it again.
        const fullSpanSec = rangeMsRef.current / 1000
        setIsZoomed(max - min < fullSpanSec - 1)
      }),
      [[], [], []],
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
  }, [])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const cutoff = Date.now() - rangeMs
    const inRange = updates.filter((update) => update.timestamp >= cutoff)
    const series = buildChartSeries(inRange)
    // setData's own resetScales:false path skips uPlot's internal commit()
    // entirely - so without an explicit redraw() below, the canvas simply
    // never repaints on a plain data tick, and the picture only updates in
    // one big jump whenever some unrelated layout reflow happens to fire the
    // ResizeObserver above. redraw() (rebuildPaths defaults true) reapplies
    // the plot's CURRENT x-scale bounds - preserving a manual drag-zoom
    // instead of re-fitting to the full data range - while still forcing the
    // repaint, so every ~1s tick lands as its own smooth, immediate update.
    plot.setData([series.xs, series.latency, series.lossPercent], false)
    plot.redraw()
  }, [updates, rangeMs])

  const fitToRange = (): void => {
    const plot = plotRef.current
    if (!plot) return
    const now = Date.now()
    plot.setScale('x', { min: Math.floor((now - rangeMs) / 1000), max: Math.floor(now / 1000) })
  }

  // Re-fit whenever the selected preset changes (not on every data tick).
  useEffect(fitToRange, [rangeMs])

  return (
    <section className="feed">
      <div className="feed-header-row">
        <h2>Latency &amp; Packet Loss</h2>
        <TimeRangeControls
          rangeMs={rangeMs}
          onSelectRange={setRangeMs}
          onResetZoom={fitToRange}
          isZoomed={isZoomed}
        />
      </div>
      <div
        ref={containerRef}
        className={`timeline-chart ${isZoomed ? 'timeline-chart--zoomed' : ''}`}
      />
    </section>
  )
}

export default TimelineChart
