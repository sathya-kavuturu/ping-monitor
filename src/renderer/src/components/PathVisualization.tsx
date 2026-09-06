import { useMemo, useState, type MouseEvent } from 'react'
import type { NetworkUpdate } from '../../../shared/types'
import { buildRouteTable, hopStatus, type HopVisualStatus, type RouteRow } from '../lib/route-table'

interface PathVisualizationProps {
  updates: NetworkUpdate[]
  targetName: string
}

interface HoverInfo {
  row: RouteRow
  status: HopVisualStatus
  isLast: boolean
  isFlagged: boolean
  /** Viewport coordinates of the hovered node - `position: fixed` anchors to these directly. */
  anchor: { left: number; top: number }
}

/** Matches `hopStatus`'s own threshold - kept as one constant so the label below stays honest. */
const OFFLINE_LOSS_THRESHOLD = 20

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function nodeLabel(row: RouteRow, isLast: boolean, targetName: string): string {
  return isLast ? targetName : `Hop ${row.hopNumber}`
}

function statusText(status: HopVisualStatus): string {
  switch (status) {
    case 'online':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'offline':
      return 'High packet loss'
    case 'silent':
      return 'No probe reply'
  }
}

/**
 * ThousandEyes-style path view: your device -> one node per router hop ->
 * the target, left to right, colored by that hop's latency/loss, with the
 * worst hop(s) called out the same way ThousandEyes flags a lossy node -
 * a ring + badge, not just a color a user might scroll past. Pure
 * client-side derivation of the same live update stream `RouteTable` uses -
 * no geolocation, no data ever leaves the machine.
 *
 * This is a single vantage point (this device) to one destination, so
 * unlike ThousandEyes' multi-agent view it can never legitimately branch
 * or merge - there's only one path to draw.
 *
 * The hover tooltip is rendered as a single `position: fixed` element
 * driven by React state (not a per-node CSS `:hover` popup) because the
 * path row lives inside `.path-viz-scroll`, which scrolls horizontally -
 * per the CSS overflow spec, giving one axis `auto` forces the other axis
 * to clip too, so a plain `position: absolute` tooltip popping upward out
 * of that row gets silently clipped by its own container. `fixed`
 * positioning escapes that entirely since it's relative to the viewport.
 */
function PathVisualization({ updates, targetName }: PathVisualizationProps): React.JSX.Element {
  const { rows, runCount } = useMemo(() => buildRouteTable(updates), [updates])
  const flaggedCount = useMemo(
    () => rows.filter((row) => hopStatus(row) === 'offline').length,
    [rows]
  )
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const handleEnter = (
    event: MouseEvent<HTMLDivElement>,
    row: RouteRow,
    status: HopVisualStatus,
    isLast: boolean,
    isFlagged: boolean
  ): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHover({
      row,
      status,
      isLast,
      isFlagged,
      anchor: { left: rect.left + rect.width / 2, top: rect.top }
    })
  }

  return (
    <section className="feed">
      <div className="feed-header-row">
        <h2>Network Path</h2>
        <span className="route-meta">
          {runCount > 0 ? `${rows.length} hops` : 'Waiting for first traceroute…'}
        </span>
      </div>

      {runCount > 0 && (
        <div className="path-highlight-note">
          Highlighting hops with packet loss &ge; {OFFLINE_LOSS_THRESHOLD}%
          {flaggedCount > 0 ? ` — ${flaggedCount} flagged` : ' — none flagged'}
        </div>
      )}

      <div className="path-viz-scroll">
        <div className="path-viz" onMouseLeave={() => setHover(null)}>
          <div className="path-node">
            <div className="path-node-dot status-online" />
            <span className="path-node-label">You</span>
          </div>

          {rows.map((row, index) => {
            const status = hopStatus(row)
            const isLast = index === rows.length - 1
            const isFlagged = status === 'offline'

            return (
              <div className="path-segment" key={row.hopNumber}>
                <div className={`path-edge path-edge--${status}`}>
                  {status !== 'silent' && (
                    <span className="path-edge-label">{formatMs(row.latencyMs)}</span>
                  )}
                </div>

                <div
                  className={[
                    'path-node',
                    isLast && 'path-node--destination',
                    isFlagged && 'path-node--flagged'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={(event) => handleEnter(event, row, status, isLast, isFlagged)}
                >
                  <div className={`path-node-dot status-${status}`}>
                    {isFlagged && <span className="path-node-badge">!</span>}
                  </div>
                  <span className="path-node-label">{nodeLabel(row, isLast, targetName)}</span>
                </div>
              </div>
            )
          })}

          {rows.length === 0 && <span className="feed-empty">No path data yet.</span>}
        </div>
      </div>

      {hover && (
        <div
          className="path-node-tooltip"
          style={{
            left: hover.anchor.left,
            top: hover.anchor.top - 10
          }}
        >
          <div className="path-tooltip-header">
            <span className={`path-node-dot path-node-dot--mini status-${hover.status}`} />
            {statusText(hover.status)}
          </div>
          <div className="path-tooltip-row">
            <span>IP Address</span>
            <span>{hover.row.address ?? '—'}</span>
          </div>
          {hover.row.hostname && (
            <div className="path-tooltip-row">
              <span>Hostname</span>
              <span>{hover.row.hostname}</span>
            </div>
          )}
          <div className="path-tooltip-row">
            <span>Avg Response</span>
            <span>{formatMs(hover.row.latencyMs)}</span>
          </div>
          <div className="path-tooltip-row">
            <span>Packet Loss</span>
            <span className={hover.isFlagged ? 'path-tooltip-bad' : undefined}>
              {hover.row.lossPercent}%
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

export default PathVisualization
