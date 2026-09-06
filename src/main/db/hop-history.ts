import { getPrisma } from './client'
import type { HopHistory } from '../../generated/prisma/client'
import type { HopHistoryQuery, HopSample } from '../../shared/types'

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
