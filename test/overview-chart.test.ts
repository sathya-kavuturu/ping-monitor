import { describe, expect, it, vi } from 'vitest'
import { buildOverviewChartData } from '../src/renderer/src/lib/overview-chart'
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

describe('buildOverviewChartData', () => {
  it('builds one shared x-axis and a series per target, labeled "name (host)"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(60_000)

    const data = buildOverviewChartData(
      [{ id: 't1', name: 'Router', host: '10.0.0.1' }],
      { t1: [update(59_000, 12)] },
      10_000
    )

    expect(data.xs[0]).toBe(50)
    expect(data.xs[data.xs.length - 1]).toBe(60)
    expect(data.series).toEqual([
      {
        targetId: 't1',
        label: 'Router (10.0.0.1)',
        latency: expect.any(Array),
        lossPercent: expect.any(Array),
        hasSample: expect.any(Array)
      }
    ])

    const secondIndex = data.xs.indexOf(59)
    expect(data.series[0].latency[secondIndex]).toBe(12)
    expect(data.series[0].hasSample[secondIndex]).toBe(true)
    expect(data.series[0].lossPercent[secondIndex]).toBe(0)

    vi.useRealTimers()
  })

  it('fills seconds with no sample as null, with hasSample false', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)

    const data = buildOverviewChartData([{ id: 't1', name: 'A', host: 'h' }], {}, 5_000)

    expect(data.series[0].latency.every((value) => value === null)).toBe(true)
    expect(data.series[0].hasSample.every((value) => value === false)).toBe(true)

    vi.useRealTimers()
  })

  it('marks a lost ping as hasSample true with 100% rolling loss', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)

    const data = buildOverviewChartData([{ id: 't1', name: 'A', host: 'h' }], { t1: [update(9_000, null)] }, 5_000)

    const secondIndex = data.xs.indexOf(9)
    expect(data.series[0].hasSample[secondIndex]).toBe(true)
    expect(data.series[0].lossPercent[secondIndex]).toBe(100)

    vi.useRealTimers()
  })
})
