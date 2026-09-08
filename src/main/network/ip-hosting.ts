import http from 'http'
import type { HopHostingInfo } from '../../shared/types'

// ip-api.com's free tier is HTTP-only (HTTPS requires a paid plan) and
// keyless - fine for looking up router hops, which are public IPs to begin
// with, not sensitive data.
const API_HOST = 'ip-api.com'

const LOOKUP_TIMEOUT_MS = 3_000

// ip-api's free tier caps out at 45 requests/minute per source IP - pacing
// requests at least this far apart keeps a burst of newly-discovered hops
// across several targets comfortably under that instead of getting
// throttled or temporarily blocked.
const MIN_REQUEST_SPACING_MS = 1_500

// A hop's owning organization essentially never changes, and the same
// router IPs repeat across traceroute runs (and often across targets) -
// caching means this only ever costs one request per unique address, not
// one per traceroute run.
const cache = new Map<string, HopHostingInfo | null>()
const inFlight = new Map<string, Promise<HopHostingInfo | null>>()

// Serializes lookups through this promise chain (rather than firing them
// all in parallel) so concurrent callers still get paced by MIN_REQUEST_SPACING_MS.
let queue: Promise<void> = Promise.resolve()
let lastRequestAt = 0

function isPrivateOrReservedIp(address: string): boolean {
  return (
    /^10\./.test(address) ||
    /^127\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^169\.254\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    address === '::1' ||
    address.startsWith('fe80:') ||
    address.startsWith('fc') ||
    address.startsWith('fd')
  )
}

function fetchHostingInfo(address: string): Promise<HopHostingInfo | null> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: API_HOST,
        path: `/json/${encodeURIComponent(address)}?fields=status,isp,org,as`,
        timeout: LOOKUP_TIMEOUT_MS
      },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            if (parsed.status !== 'success') {
              resolve(null)
              return
            }
            resolve({
              isp: parsed.isp ?? null,
              org: parsed.org ?? null,
              asn: parsed.as ?? null
            })
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

/**
 * Looks up the hosting organization/ISP for one route hop's public IP, via
 * ip-api.com's free JSON API - deliberately decoupled from the traceroute
 * pipeline (like `resolveHopHostnames`'s reverse DNS) so callers fetch this
 * on demand for whichever hops are actually being displayed, rather than
 * every hop of every run getting looked up whether it's shown or not.
 */
export function resolveHopHosting(address: string): Promise<HopHostingInfo | null> {
  if (isPrivateOrReservedIp(address)) return Promise.resolve(null)

  const cached = cache.get(address)
  if (cached !== undefined) return Promise.resolve(cached)

  const pending = inFlight.get(address)
  if (pending) return pending

  const result = queue.then(async () => {
    const wait = MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    const info = await fetchHostingInfo(address)
    cache.set(address, info)
    return info
  })
  queue = result.then(
    () => undefined,
    () => undefined
  )
  inFlight.set(address, result)
  void result.finally(() => inFlight.delete(address))
  return result
}
