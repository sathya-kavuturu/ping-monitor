import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertWatchdog, type AlertEvent } from '../src/main/alerting/watchdog'
import type { AlertRule, NetworkUpdate } from '../src/shared/types'

const TARGET = { id: 't1', name: 'Router' }

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    targetId: 't1',
    metric: 'packet_loss',
    thresholdValue: 20,
    enabled: true,
    createdAt: new Date(),
    ...overrides
  }
}

function sample(latencyMs: number | null): NetworkUpdate {
  return {
    targetId: 't1',
    timestamp: Date.now(),
    latencyMs,
    status: latencyMs === null ? 'offline' : 'online',
    hops: [],
    hopsCapturedAt: null
  }
}

describe('AlertWatchdog', () => {
  let events: AlertEvent[]
  let watchdog: AlertWatchdog

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    events = []
    watchdog = new AlertWatchdog({ onAlert: (event) => events.push(event) })
    watchdog.syncTargets([TARGET])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not evaluate a target with no rules', () => {
    watchdog.evaluate(sample(null))
    watchdog.evaluate(sample(null))
    expect(events).toEqual([])
  })

  it('does not evaluate before the minimum sample count is reached', () => {
    watchdog.syncRules([rule()])
    // Fewer than MIN_SAMPLES (5), all lost - would breach if evaluated.
    watchdog.evaluate(sample(null))
    watchdog.evaluate(sample(null))
    expect(events).toEqual([])
  })

  it('fires "triggered" once packet loss crosses the threshold', () => {
    watchdog.syncRules([rule({ thresholdValue: 20 })])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))

    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('triggered')
    expect(events[0].currentValue).toBe(100)
  })

  it('does not re-notify on every tick while still breached', () => {
    watchdog.syncRules([rule({ thresholdValue: 20 })])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))

    expect(events).toHaveLength(1)
  })

  it('re-notifies after the cooldown window while still breached', () => {
    watchdog.syncRules([rule({ thresholdValue: 20 })])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))

    vi.setSystemTime(5 * 60 * 1000 + 1)
    watchdog.evaluate(sample(null))

    expect(events).toHaveLength(2)
    expect(events[1].kind).toBe('triggered')
  })

  it('fires "recovered" once the metric drops back under threshold', () => {
    // Threshold 50: 5 lost samples breach at 100% loss; 5 more good samples
    // bring the rolling ratio down to exactly 5/10 = 50%, which recovers
    // (the check is strictly-greater-than the threshold).
    watchdog.syncRules([rule({ thresholdValue: 50 })])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(10))

    expect(events.map((e) => e.kind)).toEqual(['triggered', 'recovered'])
  })

  it('ignores disabled rules', () => {
    watchdog.syncRules([rule({ enabled: false })])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))
    expect(events).toEqual([])
  })

  it('drops trigger state for rules removed by syncRules', () => {
    watchdog.syncRules([rule()])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))
    expect(events).toHaveLength(1)

    // Re-adding the same rule id after a sync that dropped it should be
    // able to fire "triggered" again rather than remembering old state.
    watchdog.syncRules([])
    watchdog.syncRules([rule()])
    for (let i = 0; i < 5; i++) watchdog.evaluate(sample(null))
    expect(events).toHaveLength(2)
  })
})
