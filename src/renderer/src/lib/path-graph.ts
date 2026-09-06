import type { NetworkUpdate } from '../../../shared/types'
import { collectRuns } from './route-table'

/** Sentinel hop number for "this device" - the vantage point every run starts from. */
export const YOU_HOP_NUMBER = 0

export interface PathNode {
  /** Stable identity for this exact (hop number, address) pair - used as the React key and as an edge endpoint. */
  key: string
  hopNumber: number
  /** `null` = "You" (hop 0) or a hop that never replied in any retained run. */
  address: string | null
  hostname: string | null
  /** Latency from the most recent run in which this specific node was seen. */
  latencyMs: number | null
  /** How many of the retained runs passed through this exact node. */
  runCount: number
}

export interface PathEdge {
  fromKey: string
  toKey: string
  /** How many of the retained runs took this exact transition - drives line weight/opacity. */
  runCount: number
}

export interface PathColumn {
  hopNumber: number
  /** More than one entry means the runs disagree on which address answers at this hop - e.g. ECMP load-balancing - rendered as parallel branches that (usually) re-merge at the next column. */
  nodes: PathNode[]
}

export interface PathGraph {
  columns: PathColumn[]
  edges: PathEdge[]
  runCount: number
  latestCapturedAt: number | null
}

function nodeKey(hopNumber: number, address: string | null): string {
  return `${hopNumber}:${address ?? 'silent'}`
}

/**
 * Builds a directed graph of every (hop number, address) pair seen across
 * the retained traceroute runs, plus the actual hop-to-hop transitions each
 * individual run took. Unlike a single flattened path, this can represent a
 * hop that fans out to several different next-hop addresses across
 * different runs (a router load-balancing across equal-cost paths) and
 * shows them re-converging wherever the runs agree again - the same shape
 * ThousandEyes' multi-path view draws, derived here purely from repeated
 * single-vantage-point traceroutes rather than multiple agents.
 */
export function buildPathGraph(updates: NetworkUpdate[]): PathGraph {
  const runs = collectRuns(updates)

  if (runs.length === 0) {
    return { columns: [], edges: [], runCount: 0, latestCapturedAt: null }
  }

  const nodesByKey = new Map<string, PathNode>()
  const edgesByKey = new Map<string, PathEdge>()
  const youKey = nodeKey(YOU_HOP_NUMBER, null)

  for (const run of runs) {
    // Every run starts from "You", then walks its hops in ascending order -
    // a run's own hop list may have gaps/be shorter than another run's, so
    // hops are sorted per-run rather than assumed contiguous.
    const sortedHops = [...run.hops].sort((a, b) => a.hopNumber - b.hopNumber)

    let previousKey = youKey
    if (!nodesByKey.has(youKey)) {
      nodesByKey.set(youKey, {
        key: youKey,
        hopNumber: YOU_HOP_NUMBER,
        address: null,
        hostname: null,
        latencyMs: null,
        runCount: 0
      })
    }
    nodesByKey.get(youKey)!.runCount += 1

    for (const hop of sortedHops) {
      const key = nodeKey(hop.hopNumber, hop.address)
      const existing = nodesByKey.get(key)
      if (existing) {
        existing.runCount += 1
        if (hop.latencyMs !== null) existing.latencyMs = hop.latencyMs
        if (hop.hostname !== null) existing.hostname = hop.hostname
      } else {
        nodesByKey.set(key, {
          key,
          hopNumber: hop.hopNumber,
          address: hop.address,
          hostname: hop.hostname,
          latencyMs: hop.latencyMs,
          runCount: 1
        })
      }

      const edgeKey = `${previousKey}->${key}`
      const edge = edgesByKey.get(edgeKey)
      if (edge) {
        edge.runCount += 1
      } else {
        edgesByKey.set(edgeKey, { fromKey: previousKey, toKey: key, runCount: 1 })
      }

      previousKey = key
    }
  }

  const columnsByHop = new Map<number, PathNode[]>()
  for (const node of nodesByKey.values()) {
    if (node.hopNumber === YOU_HOP_NUMBER) continue
    const column = columnsByHop.get(node.hopNumber) ?? []
    column.push(node)
    columnsByHop.set(node.hopNumber, column)
  }

  const columns: PathColumn[] = Array.from(columnsByHop.keys())
    .sort((a, b) => a - b)
    .map((hopNumber) => ({
      hopNumber,
      // Stable, deterministic order: the branch every run agrees on (if
      // any) first, then the rest by how often they appeared.
      nodes: columnsByHop
        .get(hopNumber)!
        .sort((a, b) => b.runCount - a.runCount || (a.address ?? '').localeCompare(b.address ?? ''))
    }))

  return {
    columns,
    edges: Array.from(edgesByKey.values()),
    runCount: runs.length,
    latestCapturedAt: runs[runs.length - 1].capturedAt
  }
}
