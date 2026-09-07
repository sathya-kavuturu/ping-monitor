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
 * Buckets every target's live samples onto one shared per-second x-axis so
 * they can share a single uPlot chart. Each target pings independently on
 * its own ~1s timer (see `engine.ts`), so two targets' raw sample
 * timestamps don't line up exactly even at the same cadence - rounding
 * every timestamp to the nearest second gives them a common grid to plot
 * against.
 */
export function buildOverviewChartData(
  targets: Array<{ id: string; name: string; host: string }>,
  updatesByTarget: Record<string, NetworkUpdate[]>,
  windowMs: number
): OverviewChartData {
  const now = Date.now()
  const startSec = Math.floor((now - windowMs) / 1000)
  const endSec = Math.floor(now / 1000)

  const xs: number[] = []
  for (let sec = startSec; sec <= endSec; sec++) xs.push(sec)

  const series = targets.map((target) => {
    const updates = updatesByTarget[target.id] ?? []
    const rollingLoss = computeRollingLossPercent(updates)

    const bySecondLatency = new Map<number, number | null>()
    const bySecondLoss = new Map<number, number>()
    for (let i = 0; i < updates.length; i++) {
      const sec = Math.round(updates[i].timestamp / 1000)
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
