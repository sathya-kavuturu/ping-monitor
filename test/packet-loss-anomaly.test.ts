import { describe, expect, it } from 'vitest'
import { detectPacketLossAnomalies } from '../src/renderer/src/lib/packet-loss-anomaly'
import type { OverviewSeries } from '../src/renderer/src/lib/overview-chart'

function series(
  targetId: string,
  lossPercent: number[],
  hasSample: boolean[] = lossPercent.map(() => true)
): OverviewSeries {
  return {
    targetId,
    label: targetId,
    latency: lossPercent.map(() => 10),
    lossPercent,
    hasSample
  }
}

describe('detectPacketLossAnomalies', () => {
  it('flags a target whose loss is both high and far worse than its peers', () => {
    const xs = [0, 1, 2]
    const result = detectPacketLossAnomalies(xs, [
      series('bad', [0, 40, 40]),
      series('good1', [0, 0, 0]),
      series('good2', [0, 5, 5])
    ])

    expect(result.get('bad')).toHaveLength(1)
    expect(result.get('bad')?.[0]).toMatchObject({ targetId: 'bad', index: 1, lossPercent: 40 })
    expect(result.get('good1')).toEqual([])
    expect(result.get('good2')).toEqual([])
  })

  it('does not flag when every target degrades together', () => {
    const xs = [0, 1]
    const result = detectPacketLossAnomalies(xs, [
      series('a', [0, 50]),
      series('b', [0, 45]),
      series('c', [0, 55])
    ])

    expect(result.get('a')).toEqual([])
    expect(result.get('b')).toEqual([])
    expect(result.get('c')).toEqual([])
  })

  it('does not flag loss below the minimum floor even if peers are at 0', () => {
    const xs = [0, 1]
    const result = detectPacketLossAnomalies(xs, [series('a', [0, 10]), series('b', [0, 0])])

    expect(result.get('a')).toEqual([])
  })

  it('needs at least one other target present at the same second to compare against', () => {
    const xs = [0, 1]
    const result = detectPacketLossAnomalies(xs, [
      series('solo', [0, 90], [true, true]),
      series('absent', [0, 0], [true, false])
    ])

    expect(result.get('solo')).toEqual([])
  })

  it('only flags the start of a bad streak, not every second of it', () => {
    const xs = [0, 1, 2, 3, 4]
    const result = detectPacketLossAnomalies(xs, [
      series('bad', [0, 40, 40, 40, 0]),
      series('good', [0, 0, 0, 0, 0])
    ])

    expect(result.get('bad')).toHaveLength(1)
    expect(result.get('bad')?.[0].index).toBe(1)
  })

  it('flags a new streak again after loss recovers in between', () => {
    const xs = [0, 1, 2, 3]
    const result = detectPacketLossAnomalies(xs, [
      series('bad', [40, 0, 40, 40]),
      series('good', [0, 0, 0, 0])
    ])

    expect(result.get('bad')?.map((a) => a.index)).toEqual([0, 2])
  })
})
