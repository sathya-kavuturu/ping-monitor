import { describe, expect, it } from 'vitest'
import { buildPathGraph, YOU_HOP_NUMBER } from '../src/renderer/src/lib/path-graph'
import type { TraceRun } from '../src/renderer/src/lib/route-table'
import type { HopSample } from '../src/shared/types'

function hop(hopNumber: number, address: string): HopSample {
  return { hopNumber, address, hostname: null, latencyMs: 10 }
}

function run(capturedAt: number, hops: HopSample[]): TraceRun {
  return { capturedAt, hops }
}

describe('buildPathGraph', () => {
  it('returns an empty graph when no run has completed', () => {
    expect(buildPathGraph([])).toEqual({
      columns: [],
      edges: [],
      runCount: 0,
      latestCapturedAt: null
    })
  })

  it('builds a single-column-per-hop chain when every run agrees', () => {
    const graph = buildPathGraph([
      run(100, [hop(1, '10.0.0.1'), hop(2, '10.0.0.2')]),
      run(200, [hop(1, '10.0.0.1'), hop(2, '10.0.0.2')])
    ])

    expect(graph.columns.map((c) => c.nodes.length)).toEqual([1, 1])
    expect(graph.columns[0].nodes[0].address).toBe('10.0.0.1')
    expect(graph.columns[0].nodes[0].runCount).toBe(2)
    expect(graph.columns[1].nodes[0].runCount).toBe(2)

    // You -> hop1 -> hop2, each taken by both runs.
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.every((e) => e.runCount === 2)).toBe(true)
  })

  it('splits a hop into branches when runs disagree, and reports per-branch run counts', () => {
    const graph = buildPathGraph([
      run(100, [hop(1, '10.0.0.1'), hop(2, '10.0.0.2')]),
      run(200, [hop(1, '10.0.0.1'), hop(2, '10.0.0.9')]),
      run(300, [hop(1, '10.0.0.1'), hop(2, '10.0.0.2')])
    ])

    expect(graph.columns[0].nodes).toHaveLength(1)
    expect(graph.columns[1].nodes).toHaveLength(2)

    const [majority, minority] = graph.columns[1].nodes
    expect(majority.address).toBe('10.0.0.2')
    expect(majority.runCount).toBe(2)
    expect(minority.address).toBe('10.0.0.9')
    expect(minority.runCount).toBe(1)
  })

  it('re-merges branches back into a single node at the next hop', () => {
    const graph = buildPathGraph([
      run(100, [hop(1, 'A'), hop(2, 'B1'), hop(3, 'C')]),
      run(200, [hop(1, 'A'), hop(2, 'B2'), hop(3, 'C')])
    ])

    expect(graph.columns[1].nodes).toHaveLength(2) // B1, B2
    expect(graph.columns[2].nodes).toHaveLength(1) // merged back into C

    const mergedNode = graph.columns[2].nodes[0]
    const incomingEdges = graph.edges.filter((e) => e.toKey === mergedNode.key)
    expect(incomingEdges).toHaveLength(2)
    expect(incomingEdges.reduce((sum, e) => sum + e.runCount, 0)).toBe(2)
  })

  it('starts every run from a shared "You" node', () => {
    const graph = buildPathGraph([run(100, [hop(1, 'A')]), run(200, [hop(1, 'A')])])
    const youKey = `${YOU_HOP_NUMBER}:silent`
    const fromYou = graph.edges.filter((e) => e.fromKey === youKey)
    expect(fromYou).toHaveLength(1)
    expect(fromYou[0].runCount).toBe(2)
  })

  it('treats a silent (no-reply) hop as its own node distinct from a real address', () => {
    const graph = buildPathGraph([
      run(100, [hop(1, 'A'), { hopNumber: 2, address: null, hostname: null, latencyMs: null }]),
      run(200, [hop(1, 'A'), hop(2, 'B')])
    ])

    expect(graph.columns[1].nodes).toHaveLength(2)
    const silentNode = graph.columns[1].nodes.find((n) => n.address === null)
    expect(silentNode).toBeDefined()
    expect(silentNode?.runCount).toBe(1)
  })

  function silentHop(hopNumber: number): HopSample {
    return { hopNumber, address: null, hostname: null, latencyMs: null }
  }

  it("drops a one-off failed run's phantom tail once the retained window is full", () => {
    // 19 clean 2-hop runs, plus one straggler that never reached the
    // destination and silently timed out all the way to hop 25 - the exact
    // shape of traceroute-windows.ts hitting MAX_HOPS after a transient
    // hiccup on an otherwise reliably 2-hop target.
    const cleanHops = [hop(1, '192.168.154.1'), hop(2, '192.168.99.102')]
    const runs: TraceRun[] = []
    for (let i = 0; i < 19; i++) runs.push(run(i * 1000, cleanHops))
    const strandedHops = Array.from({ length: 25 }, (_, i) => silentHop(i + 1))
    runs.push(run(19_000, strandedHops))

    const graph = buildPathGraph(runs)

    // Only the two real hops remain - not 25.
    expect(graph.columns).toHaveLength(2)
    expect(graph.columns.map((c) => c.hopNumber)).toEqual([1, 2])
  })

  it('keeps a node that recurs often enough even in a full window', () => {
    const cleanHops = [hop(1, 'A'), hop(2, 'B')]
    const runs: TraceRun[] = []
    for (let i = 0; i < 15; i++) runs.push(run(i * 1000, cleanHops))
    // A router that only answers a real, recurring 25% of the time -
    // frequent enough that it shouldn't be filtered away as noise.
    for (let i = 0; i < 5; i++) runs.push(run((15 + i) * 1000, [hop(1, 'A'), hop(2, 'C')]))

    const graph = buildPathGraph(runs)
    expect(graph.columns[1].nodes.map((n) => n.address).sort()).toEqual(['B', 'C'])
  })

  it('does not filter at all while the retained window is still small', () => {
    // Only 3 runs total - well under the activation threshold, so even a
    // hop seen just once should still show (same as the branching test
    // above), rather than being mistaken for a full-window straggler.
    const graph = buildPathGraph([
      run(100, [hop(1, 'A'), hop(2, 'B')]),
      run(200, [hop(1, 'A'), hop(2, 'B')]),
      run(300, [hop(1, 'A'), ...Array.from({ length: 10 }, (_, i) => silentHop(i + 2))])
    ])

    expect(graph.columns.map((c) => c.hopNumber)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1)
    )
  })
})
