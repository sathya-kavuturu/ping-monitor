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
    // 30-second window: one loss, then 30 more hits 1s apart - the loss
    // should have aged out by the last sample, bringing loss back to 0%.
    const updates: NetworkUpdate[] = [update(0, null)]
    for (let i = 1; i <= 30; i++) updates.push(update(i * 1000, 5))

    const series = buildChartSeries(updates)
    expect(series.lossPercent[0]).toBe(100)
    expect(series.lossPercent[series.lossPercent.length - 1]).toBe(0)
  })

  it('windows by elapsed time, not sample count, so a slower ping interval is not penalized', () => {
    // Same shape as the test above (one loss, then hits), but sampled every
    // 3s instead of 1s - a sample-count-based window would still be
    // "counting" the lost sample 30 SAMPLES (90s) later; a time-based one
    // should have aged it out after 30 SECONDS (here, by the 10th sample).
    const updates: NetworkUpdate[] = [update(0, null)]
    for (let i = 1; i <= 10; i++) updates.push(update(i * 3000, 5))

    const series = buildChartSeries(updates)
    expect(series.lossPercent[0]).toBe(100)
    expect(series.lossPercent[series.lossPercent.length - 1]).toBe(0)
  })

  it('reports the same loss rate regardless of how frequently samples land', () => {
    // One loss in ten samples, whether those ten samples are 1s apart or 3s
    // apart, should read as the same ~10% rolling rate - the whole point of
    // a time-based (not sample-count-based) window.
    const fastUpdates: NetworkUpdate[] = []
    for (let i = 0; i < 10; i++) fastUpdates.push(update(i * 1000, i === 0 ? null : 5))
    const slowUpdates: NetworkUpdate[] = []
    for (let i = 0; i < 10; i++) slowUpdates.push(update(i * 3000, i === 0 ? null : 5))

    const fastSeries = buildChartSeries(fastUpdates)
    const slowSeries = buildChartSeries(slowUpdates)
    expect(fastSeries.lossPercent[fastSeries.lossPercent.length - 1]).toBe(10)
    expect(slowSeries.lossPercent[slowSeries.lossPercent.length - 1]).toBe(10)
  })
})
