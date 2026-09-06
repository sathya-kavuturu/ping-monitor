import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { NetworkUpdate } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import { buildOverviewChartData } from '../lib/overview-chart'
import { DEFAULT_RANGE_MS } from '../lib/chart-data'
import TimeRangeControls from './TimeRangeControls'

interface OverviewChartProps {
  targets: TargetWithStatus[]
  updatesByTarget: Record<string, NetworkUpdate[]>
}

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

function buildOptions(width: number, height: number, labels: string[]): uPlot.Options {
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
    cursor: { drag: { x: true, y: false } }
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

  // Rebuild only when the SET of targets changes (series count/labels/
  // colors depend on it) - not on every ~1s data tick.
  const targetsKey = useMemo(() => targets.map((target) => target.id).join(','), [targets])

  useEffect(() => {
    const container = containerRef.current
    if (!container || targets.length === 0) return

    const labels = targets.map((target) => `${target.name} (${target.host})`)
    const { width, height } = container.getBoundingClientRect()
    const initialData: uPlot.AlignedData = [[], ...targets.map(() => [])] as uPlot.AlignedData
    const plot = new uPlot(
      buildOptions(Math.max(width, 1), Math.max(height, 1), labels),
      initialData,
      container
    )
    plotRef.current = plot

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) plot.setSize({ width: w, height: h })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      plot.destroy()
      plotRef.current = null
    }
    // Deliberately keyed on targetsKey, not `targets` itself - see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey])

  useEffect(() => {
    const { xs, series } = buildOverviewChartData(targets, updatesByTarget, rangeMs)
    // resetScales: false - a manual drag-zoom (see cursor.drag above) must
    // survive the next ~1s data tick; only an explicit range change or
    // "Reset zoom" click should re-fit the x-axis (see fitToRange).
    plotRef.current?.setData([xs, ...series.map((s) => s.latency)], false)
  }, [targets, updatesByTarget, targetsKey, rangeMs])

  const fitToRange = (): void => {
    const plot = plotRef.current
    if (!plot) return
    const now = Date.now()
    plot.setScale('x', { min: Math.floor((now - rangeMs) / 1000), max: Math.floor(now / 1000) })
  }

  // Re-fit whenever the selected preset (or the target set, which rebuilds
  // the plot instance above) changes - not on every data tick.
  useEffect(fitToRange, [rangeMs, targetsKey])

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>Overview</h1>
      </header>

      <section className="feed">
        <div className="feed-header-row">
          <h2>All Targets - Latency</h2>
          {targets.length > 0 && (
            <TimeRangeControls
              rangeMs={rangeMs}
              onSelectRange={setRangeMs}
              onResetZoom={fitToRange}
            />
          )}
        </div>
        {targets.length === 0 ? (
          <p className="feed-empty">Add a target to see its latency here.</p>
        ) : (
          <div ref={containerRef} className="timeline-chart overview-chart" />
        )}
      </section>
    </main>
  )
}

export default OverviewChart
