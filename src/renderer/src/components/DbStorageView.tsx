import { useCallback, useEffect, useState } from 'react'
import type { DbStorageStats } from '../../../shared/types'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(precision)} ${UNITS[unitIndex]}`
}

/**
 * "DB Analytics" sidebar view - a snapshot of how much disk space the app's
 * SQLite database is actually using, per table, plus a rough capacity
 * projection for 30 days of history at the current target count/cadence.
 * Purely a point-in-time read (see `getDbStorageStats`) - refreshed on
 * mount and via the Refresh button, not continuously.
 */
function DbStorageView(): React.JSX.Element {
  const [stats, setStats] = useState<DbStorageStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(() => {
    setIsLoading(true)
    setError(null)
    window.api
      .getDbStorageStats()
      .then(setStats)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load storage stats')
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const targetCount = stats?.tables.find((table) => table.table === 'Target')?.rowCount ?? 0
  const maxTableBytes = Math.max(1, ...(stats?.tables.map((table) => table.bytes) ?? [1]))

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>DB Analytics</h1>
        <button
          type="button"
          className="refresh-btn"
          onClick={load}
          disabled={isLoading}
          style={{ marginLeft: 'auto' }}
        >
          Refresh
        </button>
      </header>

      {error && <p className="sidebar-error">{error}</p>}

      {stats && (
        <>
          <section className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Current DB size</span>
              <span className="stat-value">{formatBytes(stats.fileBytes)}</span>
            </div>
            <div className="stat-card stat-card--accent">
              <span className="stat-label">Approx. for 30 days</span>
              <span className="stat-value">{formatBytes(stats.estimatedBytesFor30Days)}</span>
            </div>
          </section>

          <section className="feed">
            <div className="feed-header-row">
              <h2>Storage by table</h2>
              <span className="route-meta">{formatBytes(stats.fileBytes)} total</span>
            </div>
            <ul className="storage-table-list">
              {stats.tables.map((table) => (
                <li key={table.table} className="storage-table-row">
                  <div className="storage-table-row-header">
                    <span className="storage-table-name">{table.table}</span>
                    <span className="storage-table-meta">
                      {table.rowCount.toLocaleString()} rows · {formatBytes(table.bytes)}
                    </span>
                  </div>
                  <div className="loss-bar-track">
                    <div
                      className="storage-bar-fill"
                      style={{ width: `${Math.max(2, (table.bytes / maxTableBytes) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="storage-note">
            The 30-day figure is an approximation, not a guarantee - it projects{' '}
            <strong>PingHistory</strong> (1-minute rollups) and <strong>HopHistory</strong>{' '}
            (traceroute hops) growth from today's average row size across{' '}
            {targetCount === 1 ? '1 monitored target' : `${targetCount} monitored targets`} at the
            current ping/traceroute cadence. It'll drift as hop counts and hostname lengths vary,
            and doesn't include future schema changes or index growth.
          </p>
        </>
      )}
    </main>
  )
}

export default DbStorageView
