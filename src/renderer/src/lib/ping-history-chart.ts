import type { PingHistoryRecord } from '../../../shared/types'

export interface PingHistorySeries {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending. */
  xs: number[]
  avgLatency: (number | null)[]
  /** Unix seconds of every rollup bucket with at least one lost sample - drives `TimelineChart`'s red loss markers when it's showing a long (history-backed) range. */
  lostBucketSeconds: number[]
  /** Loss percentage (0-100) actually recorded for each bucket's minute - the history-mode equivalent of `computeRollingLossPercent`'s rolling window, since a rollup row already IS a fixed one-minute aggregate rather than individual samples. */
  lossPercent: number[]
}

/**
 * Turns 1-minute ping-history rollups (already ascending by `bucketStart` -
 * see `getPingHistory`) into uPlot-ready series - used by `TimelineChart`
 * when a long range (24h/7d/30d) is selected, since the live in-memory
 * buffer doesn't go back that far.
 */
export function buildPingHistorySeries(records: PingHistoryRecord[]): PingHistorySeries {
  const xs = records.map((record) => Math.round(new Date(record.bucketStart).getTime() / 1000))
  const avgLatency = records.map((record) => record.avgLatencyMs)
  const lostBucketSeconds = records
    .filter((record) => record.lostCount > 0)
    .map((record) => Math.round(new Date(record.bucketStart).getTime() / 1000))
  const lossPercent = records.map((record) =>
    record.sampleCount > 0 ? Math.round((record.lostCount / record.sampleCount) * 100) : 0
  )

  return { xs, avgLatency, lostBucketSeconds, lossPercent }
}
