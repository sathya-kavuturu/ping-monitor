import { describe, expect, it } from 'vitest'
import { interpolateAtGap } from '../src/renderer/src/lib/chart-loss-markers'

describe('interpolateAtGap', () => {
  it('linearly interpolates between the neighbors on either side of a gap', () => {
    const latency = [10, null, 20]
    expect(interpolateAtGap(latency, 1)).toBe(15)
  })

  it('weights the interpolation by how far the gap sits between its neighbors', () => {
    const latency = [10, null, null, 40]
    // index 1 is 1/3 of the way from index 0 to index 3
    expect(interpolateAtGap(latency, 1)).toBeCloseTo(20)
    // index 2 is 2/3 of the way from index 0 to index 3
    expect(interpolateAtGap(latency, 2)).toBeCloseTo(30)
  })

  it('falls back to the next value when there is no earlier neighbor', () => {
    const latency = [null, null, 20]
    expect(interpolateAtGap(latency, 0)).toBe(20)
  })

  it('falls back to the previous value when there is no later neighbor', () => {
    const latency = [10, null, null]
    expect(interpolateAtGap(latency, 2)).toBe(10)
  })

  it('returns null when the series has no non-null value anywhere', () => {
    const latency = [null, null, null]
    expect(interpolateAtGap(latency, 1)).toBe(null)
  })
})
