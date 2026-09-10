import type { HopSample } from '../../shared/types'
import { probeHopNative } from './icmp-windows'

const MAX_HOPS = 30
const PER_HOP_TIMEOUT_MS = 1_000
// Koffi runs each async native call on a worker thread from its own fixed
// pool (not something this app can resize) - firing all 30 hops at once was
// found to starve that pool badly enough that concurrent ping probes (which
// use the same pool) got queued for 1-7 seconds and were recorded as false
// packet loss once our own timeout gave up on them. Capping how many hops
// are in flight at once keeps a trace's own footprint on that shared pool
// small, at the cost of a trace taking a few pool-sized batches instead of
// one - still far faster than the old subprocess-per-hop `tracert`.
const HOP_CONCURRENCY = 3

/**
 * Native Windows traceroute: every hop is probed by the same persistent
 * ICMP handle `icmp-windows.ts` already keeps open for ping, just with an
 * escalating TTL instead of spawning `tracert` (see traceroute.ts for the
 * subprocess-based version used on non-Windows platforms).
 *
 * Hops are probed in small concurrent batches rather than one at a time or
 * all at once - see `HOP_CONCURRENCY` above for why not "all at once".
 * Stops as soon as a batch reaches the destination, so a nearby target
 * finishes in one batch rather than paying for the full hop count.
 */
export async function runTracerouteNative(
  host: string,
  destinationIpv4: string
): Promise<HopSample[]> {
  const hops: HopSample[] = []

  for (let batchStart = 1; batchStart <= MAX_HOPS; batchStart += HOP_CONCURRENCY) {
    const ttls: number[] = []
    for (let ttl = batchStart; ttl < batchStart + HOP_CONCURRENCY && ttl <= MAX_HOPS; ttl++) {
      ttls.push(ttl)
    }

    const results = await Promise.all(
      ttls.map((ttl) =>
        probeHopNative(destinationIpv4, ttl, PER_HOP_TIMEOUT_MS).catch((error: unknown) => {
          console.error(`Native traceroute hop ${ttl} failed for ${host}:`, error)
          return { address: null, latencyMs: null, reachedDestination: false }
        })
      )
    )

    let reachedDestination = false
    for (let i = 0; i < ttls.length; i++) {
      const result = results[i]
      hops.push({
        hopNumber: ttls[i],
        address: result.address,
        hostname: null,
        latencyMs: result.latencyMs
      })
      if (result.reachedDestination) {
        reachedDestination = true
        break
      }
    }

    if (reachedDestination) break
  }

  return hops
}
