import { describe, expect, it } from 'vitest'
import { buildOverviewHistoryData } from '../src/renderer/src/lib/overview-history-chart'
import type { PingHistoryRecord } from '../src/shared/types'

function record(
  targetId: string,
  bucketStartMs: number,
  lostCount: number,
  avgLatencyMs: number | null = 12
): PingHistoryRecord {
  return {
    id: 0,
    targetId,
    bucketStart: new Date(bucketStartMs),
    sampleCount: 60,
    lostCount,
    minLatencyMs: avgLatencyMs,
    maxLatencyMs: avgLatencyMs,
    avgLatencyMs,
    avgThroughput: null
  }
}

describe('buildOverviewHistoryData', () => {
  it('keeps loss per-target instead of unioning it across every target', () => {
    // Reproduces the reported mismatch: google DNS and Instagram lost a
    // packet in the same 1-minute bucket, YouTube and Facebook did not.
    const bucketMs = 1_700_000_000_000
    const targets = [
      { id: 'google-dns' },
      { id: 'youtube' },
      { id: 'facebook' },
      { id: 'instagram' }
    ]
    const historyByTargetId = {
      'google-dns': [record('google-dns', bucketMs, 1)],
      youtube: [record('youtube', bucketMs, 0)],
      facebook: [record('facebook', bucketMs, 0)],
      instagram: [record('instagram', bucketMs, 2)]
    }

    const data = buildOverviewHistoryData(targets, historyByTargetId)
    const bucketSeconds = Math.round(bucketMs / 1000)

    expect(data.lostSecondsByTarget[0].has(bucketSeconds)).toBe(true) // google DNS
    expect(data.lostSecondsByTarget[1].has(bucketSeconds)).toBe(false) // YouTube
    expect(data.lostSecondsByTarget[2].has(bucketSeconds)).toBe(false) // Facebook
    expect(data.lostSecondsByTarget[3].has(bucketSeconds)).toBe(true) // Instagram
  })

  it('never marks a target lost at a bucket only some other target has a row for', () => {
    const bucketMs = 1_700_000_000_000
    const targets = [{ id: 'a' }, { id: 'b' }]
    const historyByTargetId = {
      a: [record('a', bucketMs, 5)],
      b: [] // no rollup at all for this bucket
    }

    const data = buildOverviewHistoryData(targets, historyByTargetId)
    const bucketSeconds = Math.round(bucketMs / 1000)

    expect(data.lostSecondsByTarget[0].has(bucketSeconds)).toBe(true)
    expect(data.lostSecondsByTarget[1].has(bucketSeconds)).toBe(false)
  })
})
