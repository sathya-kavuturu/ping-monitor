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

export async function getPingHistory(query: PingHistoryQuery): Promise<PingHistory[]> {
  const { targetId, from, to, limit = 500 } = query

  return getPrisma().pingHistory.findMany({
    where: {
      targetId,
      bucketStart: { gte: from, lte: to }
    },
    orderBy: { bucketStart: 'asc' },
    take: limit
  })
}
