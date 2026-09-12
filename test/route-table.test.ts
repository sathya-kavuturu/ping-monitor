import { describe, expect, it } from 'vitest'
import {
  buildRouteTable,
  collectRuns,
  hopStatus,
  type RouteRow,
  type TraceRun
} from '../src/renderer/src/lib/route-table'
import type { HopSample, NetworkUpdate } from '../src/shared/types'

function run(capturedAt: number, hops: HopSample[]): TraceRun {
  return { capturedAt, hops }
}

function update(hopsCapturedAt: number | null, hops: HopSample[]): NetworkUpdate {
  return {
    targetId: 't1',
    timestamp: hopsCapturedAt ?? 0,
    latencyMs: 10,
    status: 'online',
    hops,
    hopsCapturedAt
  }
}

describe('buildRouteTable', () => {
  it('returns an empty table when no run has completed', () => {
    expect(buildRouteTable([])).toEqual({ rows: [], runCount: 0, latestCapturedAt: null })
  })

  it('collapses repeated samples of the same run into a single run', () => {
    const hops: HopSample[] = [{ hopNumber: 1, address: '10.0.0.1', hostname: null, latencyMs: 5 }]
    const runs = collectRuns([update(100, hops), update(100, hops), update(100, hops)])

    const table = buildRouteTable(runs)
    expect(table.runCount).toBe(1)
    expect(table.latestCapturedAt).toBe(100)
  })

  it('aggregates loss percentage and a per-run trend for a hop across runs', () => {
    const replied: HopSample[] = [
      { hopNumber: 1, address: '10.0.0.1', hostname: null, latencyMs: 5 }
    ]
    const silent: HopSample[] = [{ hopNumber: 1, address: null, hostname: null, latencyMs: null }]

    const table = buildRouteTable([run(100, replied), run(200, silent)])

    expect(table.runCount).toBe(2)
    expect(table.rows).toEqual([
      {
        hopNumber: 1,
        address: '10.0.0.1',
        hostname: null,
        latencyMs: 5,
        lossPercent: 50,
        trend: [5, null]
      }
    ])
  })
})

describe('collectRuns', () => {
  it('collapses repeated samples sharing the same hopsCapturedAt into one run', () => {
    const hops: HopSample[] = [{ hopNumber: 1, address: '10.0.0.1', hostname: null, latencyMs: 5 }]
    const runs = collectRuns([update(100, hops), update(100, hops), update(100, hops)])
    expect(runs).toEqual([{ capturedAt: 100, hops }])
  })

  it('keeps only the most recent 20 runs', () => {
    const updates = Array.from({ length: 25 }, (_, i) =>
      update(i, [{ hopNumber: 1, address: `10.0.0.${i}`, hostname: null, latencyMs: 1 }])
    )

    const runs = collectRuns(updates)
    expect(runs).toHaveLength(20)
    expect(runs[runs.length - 1].capturedAt).toBe(24)
  })
})

describe('hopStatus', () => {
  function row(overrides: Partial<RouteRow>): RouteRow {
    return {
      hopNumber: 1,
      address: '10.0.0.1',
      hostname: null,
      latencyMs: 10,
      lossPercent: 0,
      trend: [],
      ...overrides
    }
  }

  it('is silent when the hop never replies', () => {
    expect(hopStatus(row({ address: null, latencyMs: null }))).toBe('silent')
  })

  it('is offline at 20% loss or more', () => {
    expect(hopStatus(row({ lossPercent: 20 }))).toBe('offline')
  })

  it('is degraded on any loss below 20%', () => {
    expect(hopStatus(row({ lossPercent: 5 }))).toBe('degraded')
  })

  it('is degraded when latency exceeds 150ms even with no loss', () => {
    expect(hopStatus(row({ latencyMs: 151 }))).toBe('degraded')
  })

  it('is online otherwise', () => {
    expect(hopStatus(row({ latencyMs: 50, lossPercent: 0 }))).toBe('online')
  })
})
