import type { NetworkUpdate } from '../../../shared/types'

export interface OverviewSeries {
  targetId: string
  label: string
  latency: (number | null)[]
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
    const bySecond = new Map<number, number | null>()
    for (const update of updates) {
      bySecond.set(Math.round(update.timestamp / 1000), update.latencyMs)
    }
    const latency = xs.map((sec) => bySecond.get(sec) ?? null)
    return { targetId: target.id, label: `${target.name} (${target.host})`, latency }
  })

  return { xs, series }
}
