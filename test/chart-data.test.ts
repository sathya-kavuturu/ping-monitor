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
    expect(buildChartSeries([])).toEqual({ xs: [], latency: [], lossPercent: [] })
  })

  it('converts timestamps to unix seconds and passes latency through', () => {
    const series = buildChartSeries([update(1_000, 10), update(2_000, 20)])
    expect(series.xs).toEqual([1, 2])
    expect(series.latency).toEqual([10, 20])
  })

  it('reports 0% loss when nothing is lost', () => {
    const series = buildChartSeries([update(1_000, 10), update(2_000, 20), update(3_000, 30)])
    expect(series.lossPercent).toEqual([0, 0, 0])
  })

  it('reports 100% loss while every sample so far is lost', () => {
    const series = buildChartSeries([update(1_000, null), update(2_000, null)])
    expect(series.lossPercent).toEqual([100, 100])
  })

  it('computes a rolling percentage over a mix of hits and misses', () => {
    const series = buildChartSeries([
      update(1_000, 10),
      update(2_000, null),
      update(3_000, 10),
      update(4_000, null)
    ])
    expect(series.lossPercent).toEqual([0, 50, 33, 50])
  })

  it('drops samples once they age out of the rolling window', () => {
    // 30-sample window: one loss, then 30 more hits - the loss should have
    // aged out by the last sample, bringing loss back down to 0%.
    const updates: NetworkUpdate[] = [update(0, null)]
    for (let i = 1; i <= 30; i++) updates.push(update(i * 1000, 5))

    const series = buildChartSeries(updates)
    expect(series.lossPercent[0]).toBe(100)
    expect(series.lossPercent[series.lossPercent.length - 1]).toBe(0)
  })
})
