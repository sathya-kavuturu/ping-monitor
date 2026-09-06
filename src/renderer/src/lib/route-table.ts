import type { HopSample, NetworkUpdate } from '../../../shared/types'

const MAX_RUNS = 10

export interface RouteRow {
  hopNumber: number
  address: string | null
  hostname: string | null
  /** Latency from the most recent run in which this hop replied. */
  latencyMs: number | null
  /** % of retained runs where this hop didn't reply, 0-100. */
  lossPercent: number
}

export interface RouteTable {
  rows: RouteRow[]
  /** How many distinct traceroute runs the rows below are aggregated over. */
  runCount: number
  /** When the most recent of those runs completed. */
  latestCapturedAt: number | null
}

/**
 * Reconstructs the last few completed traceroute runs from a target's live
 * update buffer (the engine repeats the same `hops`/`hopsCapturedAt` across
 * many consecutive samples until the next run finishes, so a change in
 * `hopsCapturedAt` marks a new run) and aggregates them into one row per hop
 * number with a per-hop loss percentage across those runs - the same idea
 * as MTR/WinMTR, computed entirely client-side from the IPC stream.
 */
export function buildRouteTable(updates: NetworkUpdate[]): RouteTable {
  const runsByCapturedAt = new Map<number, HopSample[]>()

  for (const update of updates) {
    if (update.hopsCapturedAt !== null && update.hops.length > 0) {
      runsByCapturedAt.set(update.hopsCapturedAt, update.hops)
    }
  }

  const capturedAts = Array.from(runsByCapturedAt.keys()).sort((a, b) => a - b)
  const recentCapturedAts = capturedAts.slice(-MAX_RUNS)
  const runs = recentCapturedAts.map((capturedAt) => runsByCapturedAt.get(capturedAt)!)

  if (runs.length === 0) {
    return { rows: [], runCount: 0, latestCapturedAt: null }
  }

  const hopNumbers = new Set<number>()
  for (const run of runs) {
    for (const hop of run) hopNumbers.add(hop.hopNumber)
  }

  const rows: RouteRow[] = Array.from(hopNumbers)
    .sort((a, b) => a - b)
    .map((hopNumber) => {
      let seenCount = 0
      let lostCount = 0
      let address: string | null = null
      let hostname: string | null = null
      let latencyMs: number | null = null

      for (const run of runs) {
        const hop = run.find((h) => h.hopNumber === hopNumber)
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
        lossPercent: seenCount > 0 ? Math.round((lostCount / seenCount) * 100) : 0
      }
    })

  return {
    rows,
    runCount: runs.length,
    latestCapturedAt: recentCapturedAts[recentCapturedAts.length - 1]
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

export function hopStatus(row: RouteRow): HopVisualStatus {
  if (row.address === null) return 'silent'
  if (row.lossPercent >= 20) return 'offline'
  if (row.lossPercent > 0) return 'degraded'
  if (row.latencyMs !== null && row.latencyMs > 150) return 'degraded'
  return 'online'
}
