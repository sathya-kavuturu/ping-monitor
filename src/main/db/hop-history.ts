import { getPrisma } from './client'
import type { HopHistory } from '../../generated/prisma/client'
import type { HopHistoryQuery, HopHistoryRangeQuery, HopSample } from '../../shared/types'

// How many of the most recent completed traceroute runs within a requested
// range to return - keeps the query bounded regardless of how wide the
// range is (a 30-day range could otherwise span tens of thousands of rows).
// Matches `route-table.ts`'s `MAX_RUNS`, the live-buffer equivalent, so a
// range-backed view and a live-buffer view retain the same number of runs.
const DEFAULT_MAX_RUNS = 20

export interface SaveHopHistoryInput {
  targetId: string
  /** Groups the hops belonging to one traceroute run together. */
  traceId: string
  hops: HopSample[]
}

export async function saveHopHistory(input: SaveHopHistoryInput): Promise<number> {
  const { targetId, traceId, hops } = input
  const result = await getPrisma().hopHistory.createMany({
    data: hops.map((hop) => ({
      targetId,
      traceId,
      hopNumber: hop.hopNumber,
      address: hop.address ?? null,
      hostname: hop.hostname ?? null,
      latencyMs: hop.latencyMs ?? null
    }))
  })
  return result.count
}

export async function getHopHistory(query: HopHistoryQuery): Promise<HopHistory[]> {
  const prisma = getPrisma()
  const { targetId, limit = 64 } = query
  let traceId = query.traceId

  if (!traceId) {
    const latest = await prisma.hopHistory.findFirst({
      where: { targetId },
      orderBy: { capturedAt: 'desc' },
      select: { traceId: true }
    })
    if (!latest) return []
    traceId = latest.traceId
  }

  return prisma.hopHistory.findMany({
    where: { targetId, traceId },
    orderBy: { hopNumber: 'asc' },
    take: limit
  })
}

/**
 * Every hop of the most recent completed traceroute runs whose `capturedAt`
 * falls within `[from, to]` - lets the Network Path/Route Table views show
 * the path as it was during whatever timeframe is selected on the latency
 * graph, instead of only ever showing the latest live traceroute.
 *
 * Finds the candidate run ids first (via `groupBy`, so only run identity +
 * timestamp is scanned) and only then fetches their full hop rows, rather
 * than pulling every hop in the range up front - a wide range (7d/30d) can
 * cover thousands of runs, and only the most recent `maxRuns` of them are
 * ever shown.
 */
export async function getHopHistoryRange(query: HopHistoryRangeQuery): Promise<HopHistory[]> {
  const prisma = getPrisma()
  const { targetId, from, to, maxRuns = DEFAULT_MAX_RUNS } = query

  const runs = await prisma.hopHistory.groupBy({
    by: ['traceId'],
    where: { targetId, capturedAt: { gte: from, lte: to } },
    _max: { capturedAt: true },
    orderBy: { _max: { capturedAt: 'desc' } },
    take: maxRuns
  })
  if (runs.length === 0) return []

  return prisma.hopHistory.findMany({
    where: { targetId, traceId: { in: runs.map((run) => run.traceId) } },
    orderBy: [{ capturedAt: 'asc' }, { hopNumber: 'asc' }]
  })
}
