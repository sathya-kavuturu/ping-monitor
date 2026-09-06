import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { NetworkUpdate } from '../../../shared/types'
import { buildChartSeries } from '../lib/chart-data'

interface TimelineChartProps {
  updates: NetworkUpdate[]
}

const COLOR_LATENCY = '#4f8cff'
const COLOR_LOSS = '#e6543e'
const COLOR_AXIS = '#8b91a2'
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)'

function buildOptions(width: number, height: number): uPlot.Options {
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
    cursor: { drag: { x: false, y: false } }
  }
}

/**
 * Thin React wrapper around uPlot (canvas-based, not React-native) - create
 * the instance once, then push new data/size into it imperatively via
 * `setData`/`setSize` rather than re-rendering the DOM every tick. That's
 * what makes it viable to redraw on every ~2s sample without jank.
 */
function TimelineChart({ updates }: TimelineChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { width, height } = container.getBoundingClientRect()
    const plot = new uPlot(buildOptions(Math.max(width, 1), Math.max(height, 1)), [[], [], []], container)
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
  }, [])

  useEffect(() => {
    const series = buildChartSeries(updates)
    plotRef.current?.setData([series.xs, series.latency, series.lossPercent])
  }, [updates])

  return <div ref={containerRef} className="timeline-chart" />
}

export default TimelineChart
