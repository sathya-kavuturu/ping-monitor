import { describe, expect, it } from 'vitest'
import { computeRecentLossPercent, lossSeverity } from '../src/renderer/src/lib/target-loss'
import type { NetworkUpdate } from '../src/shared/types'

const NOW = 1_000_000

function update(timestamp: number, latencyMs: number | null): NetworkUpdate {
  return {
    targetId: 't1',
    timestamp,
    latencyMs,
    status: latencyMs === null ? 'offline' : 'online',
    hops: [],
    hopsCapturedAt: null
  }
}

describe('computeRecentLossPercent', () => {
  it('returns null with too few recent samples', () => {
    const updates = [update(NOW - 1000, null), update(NOW - 500, null)]
    expect(computeRecentLossPercent(updates, NOW)).toBeNull()
  })

  it('ignores samples older than the window', () => {
    const stale = Array.from({ length: 10 }, (_, i) => update(NOW - 120_000 + i * 1000, null))
    const fresh = Array.from({ length: 40 }, (_, i) => update(NOW - 39_000 + i * 1000, 10))
    expect(computeRecentLossPercent([...stale, ...fresh], NOW)).toBe(0)
  })

  it('computes the percentage of lost samples within the window', () => {
    const updates = [
      update(NOW - 35_000, 10),
      update(NOW - 30_000, null),
      update(NOW - 25_000, 10),
      update(NOW - 20_000, null),
      update(NOW - 15_000, 10)
    ]
    expect(computeRecentLossPercent(updates, NOW)).toBe(40)
  })

  it('returns null when the recent samples do not yet span enough real time', () => {
    // Only ~9s of history so far, e.g. a target added moments ago - even
    // though there are enough SAMPLES, one lost packet out of five would
    // otherwise flash as a scary 20% ("critical") right after startup.
    const updates = [
      update(NOW - 9000, 10),
      update(NOW - 8000, null),
      update(NOW - 7000, 10),
      update(NOW - 6000, null),
      update(NOW - 5000, 10)
    ]
    expect(computeRecentLossPercent(updates, NOW)).toBeNull()
  })

  it('reports the same underlying loss once observed for long enough, without it looking worse early on', () => {
    // The exact real-world case reported: a target pings every ~1s, one
    // probe is lost early on, and as the window fills toward a full minute,
    // the percentage should settle rather than have ever spiked and decayed.
    const updates = [
      update(NOW - 59_000, null), // the one real loss
      ...Array.from({ length: 55 }, (_, i) => update(NOW - 55_000 + i * 1000, 10))
    ]
    expect(computeRecentLossPercent(updates, NOW)).toBeCloseTo((100 * 1) / 56, 5)
  })
})

describe('lossSeverity', () => {
  it('is none for null or zero', () => {
    expect(lossSeverity(null)).toBe('none')
    expect(lossSeverity(0)).toBe('none')
  })

  it('is warning under 5%', () => {
    expect(lossSeverity(4.9)).toBe('warning')
  })

  it('is serious from 5% up to 15%', () => {
    expect(lossSeverity(5)).toBe('serious')
    expect(lossSeverity(14.9)).toBe('serious')
  })

  it('is critical at 15% and above', () => {
    expect(lossSeverity(15)).toBe('critical')
    expect(lossSeverity(100)).toBe('critical')
  })
})
