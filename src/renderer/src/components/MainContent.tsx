import { useEffect, useMemo, useState } from 'react'
import type { HopRecord, NetworkUpdate } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import { useHopHosting } from '../lib/use-hop-hosting'
import { collectRuns, collectRunsFromHopRecords, type TraceRun } from '../lib/route-table'
import TimelineChart, { type VisibleTimeRange } from './TimelineChart'
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

  // `null` = show whatever the live buffer's latest traceroute runs are (the
  // long-standing default). Non-null pins the Network Path/Route Table to an
  // explicit timeframe - set by `TimelineChart` whenever a history preset
  // (24h/7d/30d) or a manual drag-zoom is active, so those views track
  // whatever timeframe is actually selected on the latency graph above them.
  const [explicitRange, setExplicitRange] = useState<VisibleTimeRange | null>(null)
  const [rangeHopRecords, setRangeHopRecords] = useState<HopRecord[]>([])
  const [rangeError, setRangeError] = useState<string | null>(null)
  const targetId = target?.id ?? null

  // A target switch invalidates any in-flight/previous range immediately,
  // rather than briefly showing the new target's live buffer under the old
  // target's stale explicit range (or vice versa) until `TimelineChart`
  // remounts and reports its own default.
  useEffect(() => {
    setExplicitRange(null)
    setRangeHopRecords([])
    setRangeError(null)
  }, [targetId])

  useEffect(() => {
    if (!targetId || !explicitRange) return
    let cancelled = false
    window.api
      .getHopHistoryRange({
        targetId,
        from: new Date(explicitRange.fromMs),
        to: new Date(explicitRange.toMs)
      })
      .then((records) => {
        if (!cancelled) setRangeHopRecords(records)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRangeError(error instanceof Error ? error.message : 'Failed to load path history')
        }
      })
    return () => {
      cancelled = true
    }
  }, [targetId, explicitRange])

  // The actual run set both `PathVisualization` and `RouteTable` render -
  // either the live buffer's latest runs, or the explicit-timeframe runs
  // just fetched above. Both `collectRuns` and `collectRunsFromHopRecords`
  // produce the same `TraceRun[]` shape (see `route-table.ts`), so neither
  // downstream component needs to know which source fed it.
  const runs = useMemo<TraceRun[]>(
    () => (explicitRange ? collectRunsFromHopRecords(rangeHopRecords) : collectRuns(liveUpdates)),
    [explicitRange, rangeHopRecords, liveUpdates]
  )

  // Shared across `PathVisualization` and `RouteTable` (both derived from
  // the same `runs`) so a given hop address is only ever looked up once -
  // see `useHopHosting`. Stabilized through a joined-string key (same trick
  // as `targetsKey` in `OverviewChart`) so a tick that gives `runs` a new
  // array identity doesn't also give the address list a new identity when
  // the actual set of addresses hasn't changed.
  const hopAddressesKey = useMemo(() => {
    const set = new Set<string>()
    for (const run of runs) {
      for (const hop of run.hops) {
        if (hop.address) set.add(hop.address)
      }
    }
    return Array.from(set).sort().join(',')
  }, [runs])
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

          <TimelineChart
            key={`timeline-${target.id}`}
            targetId={target.id}
            updates={liveUpdates}
            onExplicitRangeChange={setExplicitRange}
          />

          {rangeError && <p className="sidebar-error">{rangeError}</p>}

          <PathVisualization
            key={`path-${target.id}`}
            runs={runs}
            targetName={target.name}
            hostingByAddress={hostingByAddress}
          />

          <RouteTable key={`route-${target.id}`} runs={runs} hostingByAddress={hostingByAddress} />
        </>
      )}
    </main>
  )
}

export default MainContent
