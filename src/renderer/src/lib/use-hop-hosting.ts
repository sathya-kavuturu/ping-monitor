import { useEffect, useState } from 'react'
import type { HopHostingInfo } from '../../../shared/types'

/**
 * Fetches (and caches for the life of this hook instance) hosting/ISP info
 * for a set of hop addresses via `window.api.resolveHopHosting` - shared by
 * `RouteTable` and `PathVisualization` (both driven by the same target's
 * `updates`) so a given address is only ever looked up once, not once per
 * component that happens to display it.
 *
 * `addresses` should be referentially stable across renders that don't
 * actually add a new address (e.g. built with `useMemo`) - otherwise every
 * render looks like a fresh batch of "unresolved" addresses.
 */
export function useHopHosting(addresses: string[]): Map<string, HopHostingInfo | null> {
  const [hostingByAddress, setHostingByAddress] = useState<Map<string, HopHostingInfo | null>>(
    new Map()
  )

  useEffect(() => {
    const unresolved = addresses.filter((address) => !hostingByAddress.has(address))
    if (unresolved.length === 0) return

    let cancelled = false
    Promise.all(
      unresolved.map((address) =>
        window.api.resolveHopHosting(address).then((info) => [address, info] as const)
      )
    ).then((results) => {
      if (cancelled) return
      setHostingByAddress((prev) => {
        const next = new Map(prev)
        for (const [address, info] of results) next.set(address, info)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [addresses, hostingByAddress])

  return hostingByAddress
}
