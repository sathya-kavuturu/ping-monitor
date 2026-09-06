import { promises as dns } from 'dns'
import type { HopSample } from '../../shared/types'

// A hop with no PTR record can otherwise hang for the OS resolver's full
// timeout (which varies by platform and can be many seconds) - bounding
// each lookup independently means one unresponsive hop can never delay
// the others or the traceroute cadence.
const REVERSE_LOOKUP_TIMEOUT_MS = 1_500

// Router IPs repeat across traceroute runs for the same target (and often
// across different targets sharing part of the same path), and reverse DNS
// for a given IP essentially never changes - caching avoids re-resolving
// the same address on every ~30s traceroute cycle.
const cache = new Map<string, string | null>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms)
    })
  ])
}

async function resolveOne(address: string): Promise<string | null> {
  const cached = cache.get(address)
  if (cached !== undefined) return cached

  const hostname = await withTimeout(
    dns.reverse(address).then((names) => names[0] ?? null),
    REVERSE_LOOKUP_TIMEOUT_MS
  ).catch(() => null)

  cache.set(address, hostname)
  return hostname
}

/**
 * Fills in `hostname` for each hop that has an address, via reverse DNS -
 * deliberately decoupled from the traceroute itself (which runs numeric-
 * only, see `traceroute.ts`, specifically to avoid slow/hanging per-hop
 * DNS) so this can never stall the path. Every lookup is independently
 * timeout-bounded and cached by IP, so this adds negligible latency to the
 * already-slow traceroute cadence even in the worst case.
 */
export async function resolveHopHostnames(hops: HopSample[]): Promise<HopSample[]> {
  return Promise.all(
    hops.map(async (hop) => {
      if (hop.address === null || hop.hostname !== null) return hop
      const hostname = await resolveOne(hop.address)
      return hostname ? { ...hop, hostname } : hop
    })
  )
}
