import { describe, expect, it } from 'vitest'
import { buildPingHistorySeries } from '../src/renderer/src/lib/ping-history-chart'
import type { PingHistoryRecord } from '../src/shared/types'

function record(overrides: Partial<PingHistoryRecord>): PingHistoryRecord {
  return {
    id: 1,
    targetId: 't1',
    bucketStart: new Date(0),
    sampleCount: 60,
    lostCount: 0,
    minLatencyMs: 10,
    maxLatencyMs: 10,
    avgLatencyMs: 10,
    avgThroughput: null,
    ...overrides
  }
}

describe('buildPingHistorySeries', () => {
  it('returns 0% loss for a bucket with no lost samples', () => {
    const series = buildPingHistorySeries([record({ sampleCount: 60, lostCount: 0 })])
    expect(series.lossPercent).toEqual([0])
  })

  it("computes each bucket's own loss percentage from lostCount/sampleCount", () => {
    const series = buildPingHistorySeries([
      record({ sampleCount: 60, lostCount: 6 }),
      record({ sampleCount: 60, lostCount: 30 })
    ])
    expect(series.lossPercent).toEqual([10, 50])
  })

  it('does not divide by zero for an empty bucket', () => {
    const series = buildPingHistorySeries([record({ sampleCount: 0, lostCount: 0 })])
    expect(series.lossPercent).toEqual([0])
  })
})
