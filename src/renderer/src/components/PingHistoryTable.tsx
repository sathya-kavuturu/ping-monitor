import type { PingHistoryRecord } from '../../../shared/types'

interface PingHistoryTableProps {
  pingHistory: PingHistoryRecord[]
  historyError: string | null
  /** Taller scroll box for the pop-out modal view - more rows visible at once. */
  expanded?: boolean
}

function formatTime(timestamp: number | Date): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false })
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

/**
 * The ping history rollup table, factored out so the same markup renders
 * both inline (capped to ~10-15 rows behind its own scrollbar, so the page
 * doesn't grow without bound as rollups accumulate) and in the "pop out"
 * modal `MainContent` opens for a taller, more-rows-at-once view.
 */
function PingHistoryTable({
  pingHistory,
  historyError,
  expanded = false
}: PingHistoryTableProps): React.JSX.Element {
  return (
    <>
      {historyError && <p className="sidebar-error">{historyError}</p>}
      <div className={`feed-table-scroll ${expanded ? 'feed-table-scroll--expanded' : ''}`}>
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
      </div>
    </>
  )
}

export default PingHistoryTable
