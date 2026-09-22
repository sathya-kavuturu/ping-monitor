import { describe, expect, it, vi } from 'vitest'
import { attachWheelPan, isManuallyPositioned } from '../src/renderer/src/lib/chart-pan'

describe('isManuallyPositioned', () => {
  it('is false for the live default window (full span, right at now)', () => {
    const nowSec = Date.now() / 1000
    expect(isManuallyPositioned(nowSec - 300, nowSec, 300)).toBe(false)
  })

  it('is true once drag-zoomed to a narrower span', () => {
    const nowSec = Date.now() / 1000
    expect(isManuallyPositioned(nowSec - 60, nowSec, 300)).toBe(true)
  })

  it('is true once wheel-panned to an older window of the same width', () => {
    const nowSec = Date.now() / 1000
    const min = nowSec - 300 - 120
    const max = nowSec - 120
    expect(isManuallyPositioned(min, max, 300)).toBe(true)
  })
})

// This suite runs under Vitest's plain Node environment (no jsdom) - `over`
// only needs to be something `addEventListener`/`removeEventListener` work
// on, which Node's own global `EventTarget` provides without pulling in a
// DOM shim just for this test.
interface FakeUPlot {
  over: EventTarget
  scales: { x: { min: number | null; max: number | null } }
  setScale: ReturnType<typeof vi.fn>
}

function createFakePlot(min: number, max: number): FakeUPlot {
  return {
    over: new EventTarget(),
    scales: { x: { min, max } },
    setScale: vi.fn()
  }
}

function dispatchWheel(target: EventTarget, deltaY: number): void {
  const event = new Event('wheel', { cancelable: true }) as WheelEvent
  Object.defineProperty(event, 'deltaY', { value: deltaY })
  target.dispatchEvent(event)
}

describe('attachWheelPan', () => {
  it('shifts the x-scale forward on a forward scroll', () => {
    const plot = createFakePlot(1000, 1300)
    attachWheelPan(plot as unknown as import('uplot').default)

    dispatchWheel(plot.over, 1)

    expect(plot.setScale).toHaveBeenCalledTimes(1)
    const [, range] = plot.setScale.mock.calls[0] as [string, { min: number; max: number }]
    // 15% of the 300s span - moved forward (both bounds increase by the same amount).
    expect(range.max - range.min).toBeCloseTo(300, 5)
    expect(range.min).toBeCloseTo(1000 + 45, 5)
  })

  it('shifts the x-scale backward on a reverse scroll', () => {
    const plot = createFakePlot(1000, 1300)
    attachWheelPan(plot as unknown as import('uplot').default)

    dispatchWheel(plot.over, -1)

    const [, range] = plot.setScale.mock.calls[0] as [string, { min: number; max: number }]
    expect(range.min).toBeCloseTo(1000 - 45, 5)
  })

  it('never pans the window past "now"', () => {
    const nowSec = Date.now() / 1000
    // Already sitting right at the live edge - a forward scroll must not
    // push `max` past `now`, or the chart would show empty future space.
    const plot = createFakePlot(nowSec - 300, nowSec)
    attachWheelPan(plot as unknown as import('uplot').default)

    dispatchWheel(plot.over, 1)

    const [, range] = plot.setScale.mock.calls[0] as [string, { min: number; max: number }]
    expect(range.max).toBeLessThanOrEqual(nowSec + 0.01)
    expect(range.max - range.min).toBeCloseTo(300, 5)
  })

  it('detaches the listener when the returned cleanup runs', () => {
    const plot = createFakePlot(1000, 1300)
    const detach = attachWheelPan(plot as unknown as import('uplot').default)
    detach()

    dispatchWheel(plot.over, 1)

    expect(plot.setScale).not.toHaveBeenCalled()
  })
})
