import { getPrisma } from './client'
import type { PingHistory } from '../../generated/prisma/client'
import type { PingHistoryQuery } from '../../shared/types'

export interface RawPingSample {
  /** Round-trip latency in ms, or `null` if the packet was lost/timed out. */
  latencyMs: number | null
  throughputMbps: number | null
}

export interface PingRollupInput {
  targetId: string
  /** Start of the 1-minute window this rollup covers. */
  bucketStart: Date
  samples: RawPingSample[]
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Aggregates a minute's worth of raw per-second samples into a single row
 * (min/max/avg latency, packet loss, sample count) instead of storing one
 * row per second - ~1,440 rows/day/target instead of ~86,400.
 *
 * Upserts on (targetId, bucketStart) so re-flushing the same minute (e.g.
 * after a crash-recovery replay) corrects the row instead of duplicating it.
 */
export async function savePingRollup(input: PingRollupInput): Promise<PingHistory> {
  const { targetId, bucketStart, samples } = input
  if (samples.length === 0) {
    throw new Error('Cannot save a rollup with zero samples')
  }

  const latencies = samples
    .map((sample) => sample.latencyMs)
    .filter((latency): latency is number => latency !== null)
  const throughputs = samples
    .map((sample) => sample.throughputMbps)
    .filter((throughput): throughput is number => throughput !== null)

  const data = {
    targetId,
    bucketStart,
    sampleCount: samples.length,
    lostCount: samples.length - latencies.length,
    minLatencyMs: latencies.length ? Math.min(...latencies) : null,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    avgLatencyMs: latencies.length ? average(latencies) : null,
    avgThroughput: throughputs.length ? average(throughputs) : null
  }

  return getPrisma().pingHistory.upsert({
    where: { targetId_bucketStart: { targetId, bucketStart } },
    create: data,
    update: data
  })
}

// Default cap when no explicit range is given, and the floor for a
// range-derived one - about 8.3 hours of 1-minute rollups.
const DEFAULT_LIMIT = 500
// Rollups are cheap, dense rows in a local SQLite DB, but this still bounds
// a single query - comfortably above the 30-day preset's ~43,200 rows.
const MAX_LIMIT = 50_000

export async function getPingHistory(query: PingHistoryQuery): Promise<PingHistory[]> {
  const { targetId, from, to } = query

  // An explicit `from`/`to` (the history chart's day/week/month presets)
  // needs a limit sized to the range itself - the flat 500-row default
  // would silently truncate a 7-day or 30-day window down to its most
  // recent ~8 hours. Only fall back to the flat default for an unbounded
  // (no from/to) query.
  let limit = query.limit
  if (limit === undefined) {
    if (from && to) {
      const rangeMinutes = Math.ceil((to.getTime() - from.getTime()) / 60_000)
      limit = Math.min(Math.max(rangeMinutes + 5, DEFAULT_LIMIT), MAX_LIMIT)
    } else {
      limit = DEFAULT_LIMIT
    }
  }

  // Ordering by 'asc' and taking `limit` would return the OLDEST rows in
  // range, not the most recent ones - harmless for a target only a few
  // hours old, but once a target has accumulated more than `limit` minutes
  // of history, the UI would get stuck showing the same old window
  // forever and never advance. Fetch the most recent `limit` rows instead,
  // then flip back to chronological order for the caller.
  const rows = await getPrisma().pingHistory.findMany({
    where: {
      targetId,
      bucketStart: { gte: from, lte: to }
    },
    orderBy: { bucketStart: 'desc' },
    take: limit
  })

  return rows.reverse()
}
