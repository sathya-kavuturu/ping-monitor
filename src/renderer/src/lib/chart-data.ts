import type { NetworkUpdate } from '../../../shared/types'

/** How much history each target's live buffer (and the timeline chart) keeps. */
export const CHART_WINDOW_MS = 10 * 60 * 1000

// Trailing-sample window used to smooth the packet-loss series - a raw
// per-sample 0/100 signal is too spiky to read as a trend at a glance.
// ~15 samples is ~30s at the engine's 2s ping cadence.
const LOSS_ROLLING_WINDOW = 15

export interface ChartSeries {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending. */
  xs: number[]
  /** ms, `null` = lost (renders as a gap in the line). */
  latency: (number | null)[]
  /** Rolling loss percentage (0-100) over the trailing window ending at each point. */
  lossPercent: number[]
}

/**
 * Turns a target's raw live-update buffer into uPlot-ready series. Assumes
 * `updates` is already sorted ascending by timestamp (true for the buffer
 * `App.tsx` maintains, which only ever appends).
 */
export function buildChartSeries(updates: NetworkUpdate[]): ChartSeries {
  const xs: number[] = new Array(updates.length)
  const latency: (number | null)[] = new Array(updates.length)
  const lossPercent: number[] = new Array(updates.length)

  let lostInWindow = 0

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i]
    xs[i] = Math.round(update.timestamp / 1000)
    latency[i] = update.latencyMs

    if (update.latencyMs === null) lostInWindow += 1
    const dropIndex = i - LOSS_ROLLING_WINDOW
    if (dropIndex >= 0 && updates[dropIndex].latencyMs === null) lostInWindow -= 1

    const windowSize = Math.min(i + 1, LOSS_ROLLING_WINDOW)
    lossPercent[i] = Math.round((lostInWindow / windowSize) * 100)
  }

  return { xs, latency, lossPercent }
}
