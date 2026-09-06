import { useMemo } from 'react'
import type { NetworkUpdate } from '../../../shared/types'
import { buildRouteTable } from '../lib/route-table'
import Sparkline from './Sparkline'

interface RouteTableProps {
  updates: NetworkUpdate[]
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function formatAge(capturedAt: number | null): string {
  if (capturedAt === null) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - capturedAt) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

/**
 * MTR-style route table: one row per hop, aggregated across the last few
 * completed traceroute runs (see `buildRouteTable`) so loss% reflects
 * whether a hop is reliably answering, not just its single latest reply.
 * Driven entirely by the live `network:update` stream - no DB round trip.
 */
function RouteTable({ updates }: RouteTableProps): React.JSX.Element {
  const { rows, runCount, latestCapturedAt } = useMemo(() => buildRouteTable(updates), [updates])

  return (
    <section className="feed">
      <div className="feed-header-row">
        <h2>Route Table</h2>
        <span className="route-meta">
          {runCount > 0
            ? `${runCount} run${runCount === 1 ? '' : 's'} · last ${formatAge(latestCapturedAt)}`
            : 'Waiting for first traceroute…'}
        </span>
      </div>
      <table className="feed-table route-table">
        <thead>
          <tr>
            <th>Hop</th>
            <th>Address</th>
            <th>Latency</th>
            <th>Loss</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.hopNumber}>
              <td>{row.hopNumber}</td>
              <td>
                {row.address ?? '—'}
                {row.hostname && <span className="route-hostname"> ({row.hostname})</span>}
              </td>
              <td>{formatMs(row.latencyMs)}</td>
              <td>
                <div className="loss-cell">
                  <div className="loss-bar-track">
                    <div
                      className={`loss-bar-fill ${row.lossPercent > 0 ? 'loss-bar-fill--bad' : ''}`}
                      style={{ width: `${row.lossPercent}%` }}
                    />
                  </div>
                  <span>{row.lossPercent}%</span>
                </div>
              </td>
              <td>
                <Sparkline values={row.trend} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="feed-empty">
                No traceroute data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

export default RouteTable
