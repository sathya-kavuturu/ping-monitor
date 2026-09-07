import type { NetworkUpdate } from '../../../shared/types'
import { computeRollingLossPercent } from './chart-data'

export interface OverviewSeries {
  targetId: string
  label: string
  latency: (number | null)[]
  /** Rolling loss percentage per second (see `computeRollingLossPercent`) - only meaningful where `hasSample` is true. */
  lossPercent: number[]
  /** Whether this target actually had a sample land in that second - distinguishes "no data yet" from "0% loss". */
  hasSample: boolean[]
}

export interface OverviewChartData {
  /** Unix seconds (uPlot's expected unit for its time axis), ascending. */
  xs: number[]
  series: OverviewSeries[]
}

/**
 * Buckets every target's live samples onto one shared x-axis grid so they
 * can share a single uPlot chart. Each target pings independently on its
 * own timer (see `engine.ts`), so two targets' raw sample timestamps don't
 * line up exactly even at the same cadence - rounding every timestamp to
 * the nearest grid step gives them a common grid to plot against.
 *
 * The grid step is derived from the engine's current ping interval
 * (`bucketMs`), NOT hardcoded to 1s: both latency series are drawn with
 * `points: { show: false }` and `spanGaps: false` (see `OverviewChart`/
 * `IndividualLatencyChart`), so a real sample landing in a grid slot with no
 * adjacent neighbor never gets a visible dot OR a connecting line segment.
 * At the default 1s cadence a 1s grid keeps every real sample adjacent to
 * the next, but at a slower cadence (e.g. 5s) a 1s grid would leave 4 empty
 * slots between samples and the chart would render as blank - even though
 * pings are landing fine.
 */
export function buildOverviewChartData(
  targets: Array<{ id: string; name: string; host: string }>,
  updatesByTarget: Record<string, NetworkUpdate[]>,
  windowMs: number,
  bucketMs = 1000
): OverviewChartData {
  const bucketSec = Math.max(1, Math.round(bucketMs / 1000))
  const now = Date.now()
  const startSec = Math.floor((now - windowMs) / 1000 / bucketSec) * bucketSec
  const endSec = Math.floor(now / 1000 / bucketSec) * bucketSec

  const xs: number[] = []
  for (let sec = startSec; sec <= endSec; sec += bucketSec) xs.push(sec)

  const series = targets.map((target) => {
    const updates = updatesByTarget[target.id] ?? []
    const rollingLoss = computeRollingLossPercent(updates)

    const bySecondLatency = new Map<number, number | null>()
    const bySecondLoss = new Map<number, number>()
    for (let i = 0; i < updates.length; i++) {
      const sec = Math.round(updates[i].timestamp / 1000 / bucketSec) * bucketSec
      bySecondLatency.set(sec, updates[i].latencyMs)
      bySecondLoss.set(sec, rollingLoss[i])
    }

    const latency = xs.map((sec) => bySecondLatency.get(sec) ?? null)
    const lossPercent = xs.map((sec) => bySecondLoss.get(sec) ?? 0)
    const hasSample = xs.map((sec) => bySecondLatency.has(sec))

    return {
      targetId: target.id,
      label: `${target.name} (${target.host})`,
      latency,
      lossPercent,
      hasSample
    }
  })

  return { xs, series }
}
