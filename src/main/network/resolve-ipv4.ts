import { promises as dns } from 'dns'

// How long a resolved IPv4 address is trusted before being looked up again -
// long enough that a probe never waits on a fresh DNS round-trip, short
// enough to notice a target that's moved.
const IP_CACHE_TTL_MS = 5 * 60_000
const DNS_LOOKUP_TIMEOUT_MS = 3_000
const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

interface CachedAddress {
  address: string
  expiresAt: number
}

const cache = new Map<string, CachedAddress>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms)
    })
  ])
}

/**
 * Resolves a host to an IPv4 literal for the native ICMP probe paths
 * (ping-probe.ts, traceroute-windows.ts), caching the result so a probe
 * never pays for a DNS round-trip on every tick. Returns `null` (rather
 * than throwing) for anything that isn't resolvable to IPv4 within budget -
 * including AAAA-only hosts - so the caller can fall back to a
 * subprocess-based prober, which handles both families.
 */
export async function resolveIPv4(host: string): Promise<string | null> {
  const trimmed = host.trim()
  if (IPV4_LITERAL.test(trimmed)) return trimmed

  const cached = cache.get(trimmed)
  if (cached && cached.expiresAt > Date.now()) return cached.address

  const resolved = await withTimeout(
    dns.lookup(trimmed, { family: 4 }).then((result) => result.address),
    DNS_LOOKUP_TIMEOUT_MS
  ).catch(() => null)

  if (!resolved) return null
  cache.set(trimmed, { address: resolved, expiresAt: Date.now() + IP_CACHE_TTL_MS })
  return resolved
}
