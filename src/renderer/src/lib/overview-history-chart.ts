import type { PingHistoryRecord } from '../../../shared/types'

export interface OverviewHistoryData {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending - union of every bucket any target has a rollup for. */
  xs: number[]
  /** Per-target avg-latency arrays, in the same order as the `targets` argument, aligned to `xs` (`null` = no rollup for that target at that bucket). */
  series: (number | null)[][]
  /** Union of every bucket (across all targets) with at least one lost sample - feeds the combined chart's red loss markers. */
  lostSeconds: number[]
}

/**
 * Combines several targets' 1-minute ping-history rollups onto one shared
 * x-axis, the same idea as `buildOverviewChartData` but sourced from the DB
 * (`getPingHistory`) instead of the live in-memory buffer - used by
 * `OverviewChart`'s combined view once a long (24h/7d/30d) range is
 * selected. Unlike the live path, there's no fixed bucket cadence to grid
 * onto in advance: the shared `xs` is simply the union of every bucket any
 * target actually has a row for, which is fine since rollups already land
 * on real UTC minute boundaries so matching targets' buckets line up.
 */
export function buildOverviewHistoryData(
  targets: Array<{ id: string }>,
  historyByTargetId: Record<string, PingHistoryRecord[]>
): OverviewHistoryData {
  const xsSet = new Set<number>()
  const lostSecondsSet = new Set<number>()
  const bucketsByTarget = new Map<string, Map<number, PingHistoryRecord>>()

  for (const target of targets) {
    const buckets = new Map<number, PingHistoryRecord>()
    for (const record of historyByTargetId[target.id] ?? []) {
      const seconds = Math.round(new Date(record.bucketStart).getTime() / 1000)
      buckets.set(seconds, record)
      xsSet.add(seconds)
      if (record.lostCount > 0) lostSecondsSet.add(seconds)
    }
    bucketsByTarget.set(target.id, buckets)
  }

  const xs = Array.from(xsSet).sort((a, b) => a - b)
  const series = targets.map((target) => {
    const buckets = bucketsByTarget.get(target.id)
    return xs.map((seconds) => buckets?.get(seconds)?.avgLatencyMs ?? null)
  })

  return { xs, series, lostSeconds: Array.from(lostSecondsSet).sort((a, b) => a - b) }
}
