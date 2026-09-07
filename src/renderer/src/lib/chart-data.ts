import type { NetworkUpdate } from '../../../shared/types'

/**
 * How much history each target's live buffer keeps - the ceiling on how far
 * back any chart can show, independent of what range is currently selected
 * (see `RANGE_PRESETS`). Sized to the largest preset (2h) plus headroom.
 */
export const CHART_WINDOW_MS = 2 * 60 * 60 * 1000 + 60 * 1000

export interface RangePreset {
  label: string
  ms: number
}

/** Top-right time-range picker on the latency/loss charts (see `TimeRangeControls`). */
export const RANGE_PRESETS: RangePreset[] = [
  { label: '5m', ms: 5 * 60 * 1000 },
  { label: '15m', ms: 15 * 60 * 1000 },
  { label: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '2h', ms: 2 * 60 * 60 * 1000 }
]

export const DEFAULT_RANGE_MS = RANGE_PRESETS[1].ms

// Trailing-sample window used to smooth the packet-loss series - a raw
// per-sample 0/100 signal is too spiky to read as a trend at a glance.
// 30 samples is ~30s at the engine's 1s ping cadence.
const LOSS_ROLLING_WINDOW = 30

export interface ChartSeries {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending. */
  xs: number[]
  /** ms, `null` = lost (renders as a gap in the line). */
  latency: (number | null)[]
  /** Rolling loss percentage (0-100) over the trailing window ending at each point. */
  lossPercent: number[]
}

/**
 * Rolling loss percentage (0-100) over the trailing `LOSS_ROLLING_WINDOW`
 * samples ending at each index - shared by `buildChartSeries` (per-target
 * timeline) and the Overview tab's cross-target series (`overview-chart.ts`),
 * so both use the exact same smoothing.
 */
export function computeRollingLossPercent(updates: NetworkUpdate[]): number[] {
  const lossPercent: number[] = new Array(updates.length)
  let lostInWindow = 0

  for (let i = 0; i < updates.length; i++) {
    if (updates[i].latencyMs === null) lostInWindow += 1
    const dropIndex = i - LOSS_ROLLING_WINDOW
    if (dropIndex >= 0 && updates[dropIndex].latencyMs === null) lostInWindow -= 1

    const windowSize = Math.min(i + 1, LOSS_ROLLING_WINDOW)
    lossPercent[i] = Math.round((lostInWindow / windowSize) * 100)
  }

  return lossPercent
}

/**
 * Turns a target's raw live-update buffer into uPlot-ready series. Assumes
 * `updates` is already sorted ascending by timestamp (true for the buffer
 * `App.tsx` maintains, which only ever appends).
 */
export function buildChartSeries(updates: NetworkUpdate[]): ChartSeries {
  const xs = updates.map((update) => Math.round(update.timestamp / 1000))
  const latency = updates.map((update) => update.latencyMs)
  const lossPercent = computeRollingLossPercent(updates)

  return { xs, latency, lossPercent }
}
