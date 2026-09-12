import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { HopHostingInfo } from '../../../shared/types'
import { buildPathGraph, YOU_HOP_NUMBER, type PathEdge, type PathNode } from '../lib/path-graph'
import type { TraceRun } from '../lib/route-table'

interface PathVisualizationProps {
  /** Pre-collected runs from either the live buffer or a DB-backed timeframe query - see `MainContent`. */
  runs: TraceRun[]
  targetName: string
  /** Hosting/ISP info per hop address - see `useHopHosting` (owned by `MainContent`, shared with `RouteTable`). */
  hostingByAddress: Map<string, HopHostingInfo | null>
}

type NodeStatus = 'online' | 'degraded' | 'silent'

interface HoverInfo {
  node: PathNode
  status: NodeStatus
  totalRuns: number
  /** Viewport coordinates of the hovered node - `position: fixed` anchors to these directly. */
  anchor: { left: number; top: number }
}

interface Point {
  x: number
  y: number
}

interface EdgePath {
  edge: PathEdge
  d: string
}

const DEGRADED_LATENCY_MS = 150

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function nodeStatus(node: PathNode): NodeStatus {
  if (node.address === null) return 'silent'
  if (node.latencyMs !== null && node.latencyMs > DEGRADED_LATENCY_MS) return 'degraded'
  return 'online'
}

function nodeLabel(
  node: PathNode,
  isLast: boolean,
  targetName: string,
  hostingByAddress: Map<string, HopHostingInfo | null>
): string {
  if (node.hopNumber === YOU_HOP_NUMBER) return 'You'
  if (isLast) return targetName
  const hosting = node.address ? hostingByAddress.get(node.address) : null
  // Prefer the hop's hosting/network org name (e.g. "Google LLC", "Comcast
  // Cable Communications") over a raw reverse-DNS hostname - it says WHO
  // operates that hop at a glance, which a PTR record's hostname usually
  // doesn't make obvious. Falls back to the hostname, then the bare hop
  // number, for whichever of those isn't available (or never will be, for
  // a silent hop).
  return hosting?.org ?? hosting?.isp ?? node.hostname ?? `Hop ${node.hopNumber}`
}

function statusText(status: NodeStatus): string {
  switch (status) {
    case 'online':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'silent':
      return 'No probe reply'
  }
}

function youNode(totalRuns: number): PathNode {
  return {
    key: `${YOU_HOP_NUMBER}:silent`,
    hopNumber: YOU_HOP_NUMBER,
    address: null,
    hostname: null,
    latencyMs: null,
    runCount: totalRuns
  }
}

/**
 * ThousandEyes-style path view: your device -> one node per router hop ->
 * the target, colored by that hop's health, with the worst hop(s) called
 * out with a ring + badge rather than just a color a user might scroll
 * past. The graph topology itself is a pure client-side derivation of the
 * same live update stream `RouteTable` uses - no geolocation involved in
 * building it. The hover tooltip's "Hosting" row is the one exception: it
 * comes from `hostingByAddress` (see `useHopHosting`), an on-demand lookup
 * against a third-party IP-info API, shared with `RouteTable` so a given
 * hop address is only ever looked up once.
 *
 * Unlike a flat single-vantage-point trace, a hop can render as several
 * parallel nodes when repeated traceroute runs disagree on which address
 * answers there (typically a router load-balancing across equal-cost
 * paths) - `buildPathGraph` derives that branching, and re-merging, purely
 * from which (hop, address) pairs each individual run actually visited.
 *
 * The hover tooltip is rendered as a single `position: fixed` element
 * driven by React state (not a per-node CSS `:hover` popup) because the
 * path row lives inside `.path-viz-scroll`, which scrolls horizontally -
 * per the CSS overflow spec, giving one axis `auto` forces the other axis
 * to clip too, so a plain `position: absolute` tooltip popping upward out
 * of that row gets silently clipped by its own container. `fixed`
 * positioning escapes that entirely since it's relative to the viewport.
 */
function PathVisualization({
  runs,
  targetName,
  hostingByAddress
}: PathVisualizationProps): React.JSX.Element {
  const graph = useMemo(() => buildPathGraph(runs), [runs])
  const you = useMemo(() => youNode(graph.runCount), [graph.runCount])

  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([])
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const registerNodeRef =
    (key: string) =>
    (el: HTMLDivElement | null): void => {
      if (el) nodeRefs.current.set(key, el)
      else nodeRefs.current.delete(key)
    }

  const remeasureEdges = (): void => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()

    const centerOf = (key: string): Point | null => {
      const el = nodeRefs.current.get(key)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top + rect.height / 2 - containerRect.top
      }
    }

    const next: EdgePath[] = []
    for (const edge of graph.edges) {
      const from = centerOf(edge.fromKey)
      const to = centerOf(edge.toKey)
      if (!from || !to) continue
      // Cubic bezier with horizontally-offset control points - a gentle
      // S-curve that reads cleanly when several edges fan out from, or
      // converge into, the same node.
      const midX = (from.x + to.x) / 2
      next.push({
        edge,
        d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
      })
    }
    setEdgePaths(next)
  }

  useLayoutEffect(() => {
    remeasureEdges()
    const container = containerRef.current
    if (!container) return
    const resizeObserver = new ResizeObserver(() => remeasureEdges())
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
    // remeasureEdges reads graph.edges/refs directly - only re-run on data/layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const handleEnter = (event: MouseEvent<HTMLDivElement>, node: PathNode): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHover({
      node,
      status: nodeStatus(node),
      totalRuns: graph.runCount,
      anchor: { left: rect.left + rect.width / 2, top: rect.top }
    })
  }

  const branchingCount = graph.columns.filter((column) => column.nodes.length > 1).length

  return (
    <section className="feed">
      <div className="feed-header-row">
        <h2>Network Path</h2>
        <span className="route-meta">
          {graph.runCount > 0
            ? `${graph.columns.length} hops${branchingCount > 0 ? ` · ${branchingCount} branching` : ''}`
            : 'Waiting for first traceroute…'}
        </span>
      </div>

      <div className="path-viz-scroll">
        <div className="path-viz" ref={containerRef} onMouseLeave={() => setHover(null)}>
          <svg className="path-edges" aria-hidden="true">
            {edgePaths.map(({ edge, d }) => {
              const weight = graph.runCount > 0 ? edge.runCount / graph.runCount : 1
              return (
                <path
                  key={`${edge.fromKey}->${edge.toKey}`}
                  d={d}
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth={1 + weight * 2}
                  opacity={0.25 + weight * 0.55}
                />
              )
            })}
          </svg>

          <div className="path-column">
            <div className="path-node" onMouseEnter={(event) => handleEnter(event, you)}>
              <div className="path-node-dot status-online" ref={registerNodeRef(you.key)} />
              <span className="path-node-label">You</span>
            </div>
          </div>

          {graph.columns.map((column, columnIndex) => {
            const isLastColumn = columnIndex === graph.columns.length - 1
            const isBranch = column.nodes.length > 1

            return (
              <div className="path-column" key={column.hopNumber}>
                {column.nodes.map((node) => {
                  const status = nodeStatus(node)
                  return (
                    <div
                      className={[
                        'path-node',
                        isLastColumn && 'path-node--destination',
                        isBranch && 'path-node--branch'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={node.key}
                      onMouseEnter={(event) => handleEnter(event, node)}
                    >
                      <div
                        className={`path-node-dot status-${status}`}
                        ref={registerNodeRef(node.key)}
                      />
                      <span className="path-node-label">
                        {nodeLabel(node, isLastColumn, targetName, hostingByAddress)}
                      </span>
                      {isBranch && (
                        <span className="path-node-branch-tag">
                          {node.runCount}/{graph.runCount}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {graph.columns.length === 0 && <span className="feed-empty">No path data yet.</span>}
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
            <span>{hover.node.address ?? '—'}</span>
          </div>
          {hover.node.hostname && (
            <div className="path-tooltip-row">
              <span>Hostname</span>
              <span>{hover.node.hostname}</span>
            </div>
          )}
          {hover.node.address &&
            (() => {
              const hosting = hostingByAddress.get(hover.node.address)
              const label = hosting?.org ?? hosting?.isp
              return (
                label && (
                  <div className="path-tooltip-row">
                    <span>Hosting</span>
                    <span>{label}</span>
                  </div>
                )
              )
            })()}
          <div className="path-tooltip-row">
            <span>Avg Response</span>
            <span>{formatMs(hover.node.latencyMs)}</span>
          </div>
          <div className="path-tooltip-row">
            <span>Seen in</span>
            <span>
              {hover.node.runCount} of {hover.totalRuns} runs
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

export default PathVisualization
