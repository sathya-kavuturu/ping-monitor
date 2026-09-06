import { promises as dns } from 'dns'

const LOOKUP_TIMEOUT_MS = 3_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms)
    })
  ])
}

/**
 * Resolves a host the user typed (DNS name or IP literal) to an IPv4/IPv6
 * address. `dns.lookup` handles an IP literal by returning it unchanged
 * with no network call, so this is safe to call unconditionally rather than
 * pre-checking whether the input already looks like an IP.
 */
export async function resolveHostname(host: string): Promise<string | null> {
  const trimmed = host.trim()
  if (!trimmed) return null

  return withTimeout(
    dns.lookup(trimmed).then((result) => result.address),
    LOOKUP_TIMEOUT_MS
  ).catch(() => null)
}
