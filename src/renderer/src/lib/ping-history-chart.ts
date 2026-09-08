import type { PingHistoryRecord } from '../../../shared/types'

export interface PingHistorySeries {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending. */
  xs: number[]
  avgLatency: (number | null)[]
  lossPercent: number[]
}

/**
 * Turns 1-minute ping-history rollups (already ascending by `bucketStart` -
 * see `getPingHistory`) into uPlot-ready series for `PingHistoryChart`.
 */
export function buildPingHistorySeries(records: PingHistoryRecord[]): PingHistorySeries {
  const xs = records.map((record) => Math.round(new Date(record.bucketStart).getTime() / 1000))
  const avgLatency = records.map((record) => record.avgLatencyMs)
  const lossPercent = records.map((record) =>
    record.sampleCount > 0 ? Math.round((record.lostCount / record.sampleCount) * 100) : 0
  )

  return { xs, avgLatency, lossPercent }
}
