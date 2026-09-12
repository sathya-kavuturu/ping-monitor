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

/**
 * The long-range end of the merged range picker (`TIMELINE_RANGE_PRESETS`) -
 * separate from `RANGE_PRESETS` because history rollups are durable DB rows
 * (see `getPingHistory`), not the live in-memory buffer `CHART_WINDOW_MS`
 * bounds, so "how far back can I look" is measured in days, not minutes.
 */
export const HISTORY_RANGE_PRESETS: RangePreset[] = [
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', ms: 30 * 24 * 60 * 60 * 1000 }
]

export interface TimelineRangePreset extends RangePreset {
  /** Which data source this preset reads from. */
  source: 'live' | 'history'
}

/**
 * The full range picker shared by every latency chart - `TimelineChart` (a
 * target's own detail page) and both of `OverviewChart`'s views (combined
 * and individual). Short presets read the live in-memory buffer
 * (`CHART_WINDOW_MS`'s worth), long ones fetch durable 1-minute rollups
 * from the DB instead (`getPingHistory`), merged into one picker so there's
 * one chart rather than a separate "ping history" one for each.
 */
export const TIMELINE_RANGE_PRESETS: TimelineRangePreset[] = [
  ...RANGE_PRESETS.map((preset) => ({ ...preset, source: 'live' as const })),
  ...HISTORY_RANGE_PRESETS.map((preset) => ({ ...preset, source: 'history' as const }))
]

// Trailing WALL-CLOCK window used to smooth the packet-loss series - a raw
// per-sample 0/100 signal is too spiky to read as a trend at a glance.
// Deliberately time-based rather than sample-count-based: a fixed sample
// count spans a shorter real time window at a faster ping interval, which
// would make an identical underlying loss RATE read as a higher percentage
// just because more (and more closely-spaced) samples land in the window -
// exactly the "1s interval looks worse than 3s" effect this is meant to
// correct for. A trailing 30 SECONDS means the reported percentage means the
// same thing regardless of cadence. (30_000ms also exactly reproduces the
// old 30-sample window's behavior at the engine's 1s default, since a
// same-cadence run's samples are ~1000ms apart.)
const LOSS_ROLLING_WINDOW_MS = 30_000

export interface ChartSeries {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending. */
  xs: number[]
  /** ms, `null` = lost (renders as a gap in the line). */
  latency: (number | null)[]
  /** Rolling loss percentage (0-100) over the trailing window ending at each point. */
  lossPercent: number[]
}

/**
 * Rolling loss percentage (0-100) over the trailing `LOSS_ROLLING_WINDOW_MS`
 * ending at each index - shared by `buildChartSeries` (per-target timeline)
 * and the Overview tab's cross-target series (`overview-chart.ts`), so both
 * use the exact same smoothing.
 */
export function computeRollingLossPercent(updates: NetworkUpdate[]): number[] {
  const lossPercent: number[] = new Array(updates.length)
  let windowStart = 0
  let lostInWindow = 0

  for (let i = 0; i < updates.length; i++) {
    if (updates[i].latencyMs === null) lostInWindow += 1

    while (updates[i].timestamp - updates[windowStart].timestamp >= LOSS_ROLLING_WINDOW_MS) {
      if (updates[windowStart].latencyMs === null) lostInWindow -= 1
      windowStart += 1
    }

    const windowSize = i - windowStart + 1
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
