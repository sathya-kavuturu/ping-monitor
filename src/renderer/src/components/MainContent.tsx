import type { NetworkUpdate, PingHistoryRecord } from '../../../shared/types'
import type { TargetWithStatus } from '../App'
import TimelineChart from './TimelineChart'
import PathVisualization from './PathVisualization'
import RouteTable from './RouteTable'
import AlertRules from './AlertRules'

interface MainContentProps {
  target: TargetWithStatus | null
  liveUpdates: NetworkUpdate[]
  pingHistory: PingHistoryRecord[]
  historyError: string | null
  onRefreshHistory: () => void
}

function formatTime(timestamp: number | Date): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false })
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

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>{target ? target.name : 'Select a target'}</h1>
        {target && (
          <span className={`status-badge status-${target.status}`}>{target.status}</span>
        )}
      </header>

      {target && (
        <>
          <section className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Host</span>
              <span className="stat-value">{target.host}</span>
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

          <AlertRules key={target.id} targetId={target.id} />

          <section className="feed">
            <h2>Latency &amp; Packet Loss (last 10 min)</h2>
            <TimelineChart key={target.id} updates={liveUpdates} />
          </section>

          <PathVisualization key={`path-${target.id}`} updates={liveUpdates} targetName={target.name} />

          <RouteTable key={target.id} updates={liveUpdates} />

          <section className="feed">
            <div className="feed-header-row">
              <h2>Ping History (1-min rollups)</h2>
              <button type="button" className="refresh-btn" onClick={onRefreshHistory}>
                Refresh
              </button>
            </div>
            {historyError && <p className="sidebar-error">{historyError}</p>}
            <table className="feed-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Samples</th>
                  <th>Loss</th>
                  <th>Min</th>
                  <th>Avg</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                {pingHistory
                  .slice()
                  .reverse()
                  .map((row) => (
                    <tr key={row.id}>
                      <td>{formatTime(row.bucketStart)}</td>
                      <td>{row.sampleCount}</td>
                      <td>{Math.round((row.lostCount / row.sampleCount) * 100)}%</td>
                      <td>{formatMs(row.minLatencyMs)}</td>
                      <td>{formatMs(row.avgLatencyMs)}</td>
                      <td>{formatMs(row.maxLatencyMs)}</td>
                    </tr>
                  ))}
                {pingHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="feed-empty">
                      No rollups yet - the first one lands about a minute after this target is added.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  )
}

export default MainContent
