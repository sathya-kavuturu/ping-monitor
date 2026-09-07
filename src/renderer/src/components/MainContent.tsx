import { useEffect, useState } from 'react'
import type { NetworkUpdate, PingHistoryRecord } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import TimelineChart from './TimelineChart'
import PathVisualization from './PathVisualization'
import RouteTable from './RouteTable'
import PingHistoryTable from './PingHistoryTable'
import Modal from './Modal'

interface MainContentProps {
  target: TargetWithStatus | null
  liveUpdates: NetworkUpdate[]
  pingHistory: PingHistoryRecord[]
  historyError: string | null
  onRefreshHistory: () => void
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
  onRefreshHistory
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
          />

          <RouteTable key={`route-${target.id}`} updates={liveUpdates} />

          <section className="feed">
            <div className="feed-header-row">
              <h2>Ping History (1-min rollups)</h2>
              <div className="feed-header-actions">
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
            <PingHistoryTable pingHistory={pingHistory} historyError={historyError} />
          </section>

          {isHistoryExpanded && (
            <Modal
              title="Ping History (1-min rollups)"
              onClose={() => setIsHistoryExpanded(false)}
              className="modal-card--wide"
            >
              <div className="modal-actions modal-actions--start">
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
              <PingHistoryTable pingHistory={pingHistory} historyError={historyError} expanded />
            </Modal>
          )}
        </>
      )}
    </main>
  )
}

export default MainContent
