import type { HopSample, NetworkUpdate } from '../../../shared/types'

const MAX_RUNS = 20

export interface TraceRun {
  capturedAt: number
  hops: HopSample[]
}

/**
 * Reconstructs the last few completed traceroute runs from a target's live
 * update buffer - the engine repeats the same `hops`/`hopsCapturedAt` across
 * many consecutive samples until the next run finishes, so a change in
 * `hopsCapturedAt` marks a new run. Shared by `buildRouteTable` (aggregate
 * stats + per-hop trend) and `buildPathGraph` (branch/merge topology) so
 * both work off the exact same run history.
 */
export function collectRuns(updates: NetworkUpdate[], maxRuns: number = MAX_RUNS): TraceRun[] {
  const runsByCapturedAt = new Map<number, HopSample[]>()

  for (const update of updates) {
    if (update.hopsCapturedAt !== null && update.hops.length > 0) {
      runsByCapturedAt.set(update.hopsCapturedAt, update.hops)
    }
  }

  const capturedAts = Array.from(runsByCapturedAt.keys()).sort((a, b) => a - b)
  return capturedAts
    .slice(-maxRuns)
    .map((capturedAt) => ({ capturedAt, hops: runsByCapturedAt.get(capturedAt)! }))
}

export interface RouteRow {
  hopNumber: number
  address: string | null
  hostname: string | null
  /** Latency from the most recent run in which this hop replied. */
  latencyMs: number | null
  /** % of retained runs where this hop didn't reply, 0-100. */
  lossPercent: number
  /** One entry per retained run, oldest first - `null` = lost/silent that run. Feeds the route table's trend sparkline. */
  trend: (number | null)[]
}

export interface RouteTable {
  rows: RouteRow[]
  /** How many distinct traceroute runs the rows below are aggregated over. */
  runCount: number
  /** When the most recent of those runs completed. */
  latestCapturedAt: number | null
}

/**
 * Aggregates the last few completed traceroute runs (see `collectRuns`) into
 * one row per hop number with a per-hop loss percentage across those runs -
 * the same idea as MTR/WinMTR, computed entirely client-side from the IPC
 * stream.
 */
export function buildRouteTable(updates: NetworkUpdate[]): RouteTable {
  const runs = collectRuns(updates)

  if (runs.length === 0) {
    return { rows: [], runCount: 0, latestCapturedAt: null }
  }

  const hopNumbers = new Set<number>()
  for (const run of runs) {
    for (const hop of run.hops) hopNumbers.add(hop.hopNumber)
  }

  const rows: RouteRow[] = Array.from(hopNumbers)
    .sort((a, b) => a - b)
    .map((hopNumber) => {
      let seenCount = 0
      let lostCount = 0
      let address: string | null = null
      let hostname: string | null = null
      let latencyMs: number | null = null
      const trend: (number | null)[] = []

      for (const run of runs) {
        const hop = run.hops.find((h) => h.hopNumber === hopNumber)
        trend.push(hop?.latencyMs ?? null)
        if (!hop) continue

        seenCount += 1
        if (hop.address === null) {
          lostCount += 1
        } else {
          address = hop.address
          hostname = hop.hostname
          latencyMs = hop.latencyMs
        }
      }

      return {
        hopNumber,
        address,
        hostname,
        latencyMs,
        lossPercent: seenCount > 0 ? Math.round((lostCount / seenCount) * 100) : 0,
        trend
      }
    })

  return {
    rows,
    runCount: runs.length,
    latestCapturedAt: runs[runs.length - 1].capturedAt
  }
}

/**
 * Four-state status for one route hop - a superset of the sidebar's
 * three-tier status because a router that never answers traceroute probes
 * ('silent') is extremely common and NOT the same problem as one that's
 * demonstrably dropping the packets it does see ('offline'). Conflating
 * them would paint most real-world paths solid red for no reason - MTR/
 * WinMTR make the same distinction.
 */
export type HopVisualStatus = 'online' | 'degraded' | 'offline' | 'silent'

export function hopStatus(
  row: Pick<RouteRow, 'address' | 'lossPercent' | 'latencyMs'>
): HopVisualStatus {
  if (row.address === null) return 'silent'
  if (row.lossPercent >= 20) return 'offline'
  if (row.lossPercent > 0) return 'degraded'
  if (row.latencyMs !== null && row.latencyMs > 150) return 'degraded'
  return 'online'
}
