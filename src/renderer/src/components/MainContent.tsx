import { useEffect, useMemo, useState } from 'react'
import type { NetworkUpdate, PingHistoryRecord } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import { useHopHosting } from '../lib/use-hop-hosting'
import TimelineChart from './TimelineChart'
import PathVisualization from './PathVisualization'
import RouteTable from './RouteTable'
import PingHistoryChart from './PingHistoryChart'
import PingHistoryRangeControls from './PingHistoryRangeControls'
import Modal from './Modal'

interface MainContentProps {
  target: TargetWithStatus | null
  liveUpdates: NetworkUpdate[]
  pingHistory: PingHistoryRecord[]
  historyError: string | null
  onRefreshHistory: () => void
  historyRangeMs: number
  onSelectHistoryRange: (ms: number) => void
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function formatAge(capturedAt: number | null): string {
  if (capturedAt === null) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - capturedAt) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

function MainContent({
  target,
  liveUpdates,
  pingHistory,
  historyError,
  onRefreshHistory,
  historyRangeMs,
  onSelectHistoryRange
}: MainContentProps): React.JSX.Element {
  const latest = liveUpdates[liveUpdates.length - 1]
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false)

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

  useEffect(() => setIsHistoryExpanded(false), [target?.id])

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

          <TimelineChart key={`timeline-${target.id}`} updates={liveUpdates} />

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

          <section className="feed">
            <div className="feed-header-row">
              <h2>Ping History</h2>
              <div className="feed-header-actions">
                <PingHistoryRangeControls
                  rangeMs={historyRangeMs}
                  onSelectRange={onSelectHistoryRange}
                />
                <button type="button" className="refresh-btn" onClick={onRefreshHistory}>
                  Refresh
                </button>
                <button
                  type="button"
                  className="refresh-btn"
                  onClick={() => setIsHistoryExpanded(true)}
                >
                  Pop out
                </button>
              </div>
            </div>
            <PingHistoryChart pingHistory={pingHistory} historyError={historyError} />
          </section>

          {isHistoryExpanded && (
            <Modal
              title="Ping History"
              onClose={() => setIsHistoryExpanded(false)}
              className="modal-card--wide"
            >
              <div className="modal-actions modal-actions--start">
                <PingHistoryRangeControls
                  rangeMs={historyRangeMs}
                  onSelectRange={onSelectHistoryRange}
                />
                <button type="button" className="refresh-btn" onClick={onRefreshHistory}>
                  Refresh
                </button>
                <button
                  type="button"
                  className="refresh-btn"
                  onClick={() => setIsHistoryExpanded(false)}
                >
                  Merge back into tab
                </button>
              </div>
              <PingHistoryChart pingHistory={pingHistory} historyError={historyError} expanded />
            </Modal>
          )}
        </>
      )}
    </main>
  )
}

export default MainContent
