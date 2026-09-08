import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { PingHistoryRecord } from '../../../shared/types'
import { buildPingHistorySeries } from '../lib/ping-history-chart'

interface PingHistoryChartProps {
  pingHistory: PingHistoryRecord[]
  historyError: string | null
  /** Taller chart for the pop-out modal view. */
  expanded?: boolean
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
      y: { range: (_self, _min, max) => [0, Math.max(50, max * 1.2)] },
      loss: { range: [0, 100] }
    },
    axes: [
      { stroke: COLOR_AXIS, grid: { stroke: COLOR_GRID }, ticks: { stroke: COLOR_GRID } },
      {
        scale: 'y',
        label: 'Avg latency (ms)',
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
        label: 'Avg latency',
        scale: 'y',
        stroke: COLOR_LATENCY,
        width: 2,
        spanGaps: true,
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
    // Drag-select on the x-axis zooms into that range, same as the other
    // charts - there's no "reset zoom" control here because picking a new
    // preset (or hitting Refresh) already reloads fresh data, which re-fits
    // to the full range on its own (see the setData effect below).
    cursor: { drag: { x: true, y: false } }
  }
}

/**
 * Chart view of the ping-history rollups, replacing the old plain table -
 * unlike `TimelineChart`, this isn't a live ~1s tick stream: `pingHistory`
 * only changes when the parent loads a new range or the user hits Refresh,
 * so every update can simply auto-fit to the new data (uPlot's default
 * `resetScales: true`) rather than needing the live charts' dance to
 * preserve a manual zoom across ticks.
 */
function PingHistoryChart({
  pingHistory,
  historyError,
  expanded = false
}: PingHistoryChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { width, height } = container.getBoundingClientRect()
    const plot = new uPlot(
      buildOptions(Math.max(width, 1), Math.max(height, 1)),
      [[], [], []],
      container
    )
    plotRef.current = plot

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width: w, height: h } = entry.contentRect
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
    const series = buildPingHistorySeries(pingHistory)
    plot.setData([series.xs, series.avgLatency, series.lossPercent])
  }, [pingHistory])

  return (
    <>
      {historyError && <p className="sidebar-error">{historyError}</p>}
      <div
        ref={containerRef}
        className={`timeline-chart ping-history-chart ${expanded ? 'ping-history-chart--expanded' : ''}`}
      />
      {pingHistory.length === 0 && !historyError && (
        <p className="feed-empty">No rollups yet for this range.</p>
      )}
    </>
  )
}

export default PingHistoryChart
