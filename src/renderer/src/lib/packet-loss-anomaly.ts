import type { OverviewSeries } from './overview-chart'

export interface PacketLossAnomaly {
  targetId: string
  /** Index into the shared `xs`/series arrays this was detected at. */
  index: number
  timestampSec: number
  lossPercent: number
  /** Average rolling loss of every other target that had a sample at the same second. */
  othersAvgLossPercent: number
  /** That target's own latency at this second - `null` if this particular second was itself a lost ping. */
  latencyMs: number | null
}

// This target's own rolling loss must clear this floor...
const MIN_LOSS_PERCENT = 20
// ...AND beat the average of every other target sampled at the same moment
// by at least this many points, before it counts as "clearly worse than its
// peers" rather than everyone having a rough patch together (e.g. the local
// network hiccups, which isn't a per-target fault).
const MIN_DELTA_PERCENT = 20

/**
 * Cross-target packet-loss outlier detection for the Overview tab. At each
 * shared one-second tick, flags a target whose trailing-window loss rate is
 * both meaningfully bad and meaningfully worse than its peers at that same
 * instant.
 *
 * Only the *start* of each bad streak is flagged (edge-detected) rather than
 * every second the target stays degraded, so one red dot marks "this went
 * bad here" per incident instead of painting the whole window red.
 */
export function detectPacketLossAnomalies(
  xs: number[],
  series: OverviewSeries[]
): Map<string, PacketLossAnomaly[]> {
  const anomaliesByTarget = new Map<string, PacketLossAnomaly[]>()
  for (const s of series) anomaliesByTarget.set(s.targetId, [])

  let wasAnomalous = new Set<string>()

  for (let i = 0; i < xs.length; i++) {
    const present = series.filter((s) => s.hasSample[i])
    const nowAnomalous = new Set<string>()

    if (present.length >= 2) {
      for (const s of present) {
        const others = present.filter((o) => o.targetId !== s.targetId)
        const othersAvg = others.reduce((sum, o) => sum + o.lossPercent[i], 0) / others.length
        const loss = s.lossPercent[i]

        if (loss >= MIN_LOSS_PERCENT && loss - othersAvg >= MIN_DELTA_PERCENT) {
          nowAnomalous.add(s.targetId)

          if (!wasAnomalous.has(s.targetId)) {
            anomaliesByTarget.get(s.targetId)!.push({
              targetId: s.targetId,
              index: i,
              timestampSec: xs[i],
              lossPercent: loss,
              othersAvgLossPercent: Math.round(othersAvg),
              latencyMs: s.latency[i]
            })
          }
        }
      }
    }

    wasAnomalous = nowAnomalous
  }

  return anomaliesByTarget
}
