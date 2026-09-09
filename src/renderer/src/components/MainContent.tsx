import { useEffect, useMemo, useState } from 'react'
import type { NetworkUpdate } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import { useHopHosting } from '../lib/use-hop-hosting'
import TimelineChart from './TimelineChart'
import PathVisualization from './PathVisualization'
import RouteTable from './RouteTable'

interface MainContentProps {
  target: TargetWithStatus | null
  liveUpdates: NetworkUpdate[]
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function formatAge(capturedAt: number | null): string {
  if (capturedAt === null) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - capturedAt) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

function MainContent({ target, liveUpdates }: MainContentProps): React.JSX.Element {
  const latest = liveUpdates[liveUpdates.length - 1]

  // Forward-resolved just for display (e.g. "example.com (93.184.216.34)")
  // - the target keeps monitoring whatever host it was created with.
  const [resolvedIp, setResolvedIp] = useState<string | null>(null)
  const targetHost = target?.host ?? null
  useEffect(() => {
    setResolvedIp(null)
    if (!targetHost) return
    let cancelled = false
    window.api
      .resolveHostname(targetHost)
      .then((ip) => {
        if (!cancelled) setResolvedIp(ip)
      })
      .catch(() => {
        if (!cancelled) setResolvedIp(null)
      })
    return () => {
      cancelled = true
    }
  }, [targetHost])

  const showResolvedIp = resolvedIp !== null && target !== null && resolvedIp !== target.host

  // Shared across `PathVisualization` and `RouteTable` (both derived from
  // the same `liveUpdates`) so a given hop address is only ever looked up
  // once - see `useHopHosting`. Stabilized through a joined-string key
  // (same trick as `targetsKey` in `OverviewChart`) so the ~1s tick that
  // gives `liveUpdates` a new array identity doesn't also give the address
  // list a new identity when the actual set of addresses hasn't changed.
  const hopAddressesKey = useMemo(() => {
    const set = new Set<string>()
    for (const update of liveUpdates) {
      for (const hop of update.hops) {
        if (hop.address) set.add(hop.address)
      }
    }
    return Array.from(set).sort().join(',')
  }, [liveUpdates])
  const hopAddresses = useMemo(
    () => (hopAddressesKey ? hopAddressesKey.split(',') : []),
    [hopAddressesKey]
  )
  const hostingByAddress = useHopHosting(hopAddresses)

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>{target ? target.name : 'Select a target'}</h1>
        {target && <span className={`status-badge status-${target.status}`}>{target.status}</span>}
      </header>

      {target && (
        <>
          <section className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Host</span>
              <span className="stat-value">
                {target.host}
                {showResolvedIp && <span className="stat-value-sub"> ({resolvedIp})</span>}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Latency</span>
              <span className="stat-value">{latest ? formatMs(latest.latencyMs) : '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Hops</span>
              <span className="stat-value">{latest ? latest.hops.length : '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Path captured</span>
              <span className="stat-value">{latest ? formatAge(latest.hopsCapturedAt) : '—'}</span>
            </div>
          </section>

          <TimelineChart key={`timeline-${target.id}`} targetId={target.id} updates={liveUpdates} />

          <PathVisualization
            key={`path-${target.id}`}
            updates={liveUpdates}
            targetName={target.name}
            hostingByAddress={hostingByAddress}
          />

          <RouteTable
            key={`route-${target.id}`}
            updates={liveUpdates}
            hostingByAddress={hostingByAddress}
          />
        </>
      )}
    </main>
  )
}

export default MainContent
