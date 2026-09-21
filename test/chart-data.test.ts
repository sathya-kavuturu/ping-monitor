import { describe, expect, it } from 'vitest'
import { buildChartSeries } from '../src/renderer/src/lib/chart-data'
import type { NetworkUpdate } from '../src/shared/types'

function update(timestampMs: number, latencyMs: number | null): NetworkUpdate {
  return {
    targetId: 't1',
    timestamp: timestampMs,
    latencyMs,
    status: latencyMs === null ? 'offline' : 'online',
    hops: [],
    hopsCapturedAt: null
  }
}

describe('buildChartSeries', () => {
  it('returns empty series for no updates', () => {
    expect(buildChartSeries([])).toEqual({ xs: [], latency: [] })
  })

  it('converts timestamps to unix seconds and passes latency through', () => {
    const series = buildChartSeries([update(1_000, 10), update(2_000, 20)])
    expect(series.xs).toEqual([1, 2])
    expect(series.latency).toEqual([10, 20])
  })

  it('passes a lost sample through as null', () => {
    const series = buildChartSeries([update(1_000, 10), update(2_000, null)])
    expect(series.latency).toEqual([10, null])
  })

  it('sorts by timestamp instead of trusting arrival order', () => {
    // A slow probe from an earlier tick can resolve after a faster probe
    // from a later tick already has - the update for second 1 arriving
    // after second 2 here reproduces that.
    const series = buildChartSeries([update(2_000, 20), update(1_000, 10), update(3_000, 30)])
    expect(series.xs).toEqual([1, 2, 3])
    expect(series.latency).toEqual([10, 20, 30])
  })
})
