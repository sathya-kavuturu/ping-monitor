import type { HopSample } from '../../shared/types'
import { probeHopNative } from './icmp-windows'

const MAX_HOPS = 30
const PER_HOP_TIMEOUT_MS = 1_000

/**
 * Native Windows traceroute: every hop is probed by the same persistent
 * ICMP handle `icmp-windows.ts` already keeps open for ping, just with an
 * escalating TTL instead of spawning `tracert` (see traceroute.ts for the
 * subprocess-based version used on non-Windows platforms).
 *
 * All hops are fired concurrently rather than TTL-by-TTL: each probe is an
 * independent OS call keyed to its own TTL, so there's no ordering
 * requirement between them, and firing them together turns a trace that
 * could take up to `MAX_HOPS * PER_HOP_TIMEOUT_MS` (30s) into one that's
 * bounded by the slowest single hop (~1s) - both faster, and far less time
 * spent generating traceroute traffic that could contend with an
 * in-progress ping tick.
 */
export async function runTracerouteNative(
  host: string,
  destinationIpv4: string
): Promise<HopSample[]> {
  const probes = await Promise.all(
    Array.from({ length: MAX_HOPS }, (_, index) => {
      const ttl = index + 1
      return probeHopNative(destinationIpv4, ttl, PER_HOP_TIMEOUT_MS)
        .then((result) => ({ ttl, result }))
        .catch((error: unknown) => {
          console.error(`Native traceroute hop ${ttl} failed for ${host}:`, error)
          return { ttl, result: { address: null, latencyMs: null, reachedDestination: false } }
        })
    })
  )

  const hops: HopSample[] = []
  for (const { ttl, result } of probes) {
    hops.push({
      hopNumber: ttl,
      address: result.address,
      hostname: null,
      latencyMs: result.latencyMs
    })
    if (result.reachedDestination) break
  }

  return hops
}
