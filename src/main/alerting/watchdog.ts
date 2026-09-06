import type { AlertRule, NetworkUpdate } from '../../shared/types'

export interface WatchdogTarget {
  id: string
  name: string
}

export interface AlertEvent {
  rule: AlertRule
  target: WatchdogTarget
  kind: 'triggered' | 'recovered'
  /** The metric value that triggered/cleared the rule (percent or ms, per `rule.metric`). */
  currentValue: number
  timestamp: number
}

// ~1 minute of samples at the engine's 1s ping cadence.
const WINDOW_SIZE = 60
// Don't evaluate off a handful of samples right after a target is added -
// one lost packet out of two looks like 50% loss.
const MIN_SAMPLES = 5
// Once a rule is breached and has notified, don't re-notify on every
// subsequent tick while it stays breached - only every 5 minutes.
const RENOTIFY_COOLDOWN_MS = 5 * 60 * 1000

interface Sample {
  latencyMs: number | null
}

interface TriggerState {
  breached: boolean
  lastNotifiedAt: number
}

/**
 * Evaluates every live `NetworkUpdate` against the configured `AlertRule`s
 * for its target, over a rolling window it maintains itself (independent of
 * the DB's 1-minute rollups, which flush too slowly for near-real-time
 * alerting). Edge-triggered: fires once on the OK->breached transition, then
 * again only every `RENOTIFY_COOLDOWN_MS` while still breached, plus once
 * more on breached->OK ("recovered"). Knows nothing about notifications or
 * IPC - it just calls `onAlert`.
 */
export class AlertWatchdog {
  private readonly windows = new Map<string, Sample[]>()
  private readonly rulesByTarget = new Map<string, AlertRule[]>()
  private readonly targetsById = new Map<string, WatchdogTarget>()
  private readonly triggerStates = new Map<string, TriggerState>()
  private readonly onAlert: (event: AlertEvent) => void

  constructor(options: { onAlert: (event: AlertEvent) => void }) {
    this.onAlert = options.onAlert
  }

  syncTargets(targets: WatchdogTarget[]): void {
    this.targetsById.clear()
    for (const target of targets) {
      this.targetsById.set(target.id, target)
    }
  }

  syncRules(rules: AlertRule[]): void {
    this.rulesByTarget.clear()
    const liveRuleIds = new Set<string>()

    for (const rule of rules) {
      liveRuleIds.add(rule.id)
      const forTarget = this.rulesByTarget.get(rule.targetId) ?? []
      forTarget.push(rule)
      this.rulesByTarget.set(rule.targetId, forTarget)
    }

    for (const ruleId of this.triggerStates.keys()) {
      if (!liveRuleIds.has(ruleId)) this.triggerStates.delete(ruleId)
    }
  }

  evaluate(update: NetworkUpdate): void {
    const window = this.windows.get(update.targetId) ?? []
    window.push({ latencyMs: update.latencyMs })
    if (window.length > WINDOW_SIZE) window.shift()
    this.windows.set(update.targetId, window)

    const rules = this.rulesByTarget.get(update.targetId)
    if (!rules || rules.length === 0) return
    if (window.length < MIN_SAMPLES) return

    const target = this.targetsById.get(update.targetId)
    if (!target) return

    const lostCount = window.filter((sample) => sample.latencyMs === null).length
    const packetLossPercent = (lostCount / window.length) * 100

    const latencies = window
      .map((sample) => sample.latencyMs)
      .filter((latency): latency is number => latency !== null)
    const avgLatencyMs =
      latencies.length > 0
        ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
        : null

    for (const rule of rules) {
      if (!rule.enabled) continue

      const currentValue = rule.metric === 'packet_loss' ? packetLossPercent : avgLatencyMs
      // Can't say anything about latency while every recent sample was lost.
      if (currentValue === null) continue

      this.checkRule(rule, target, currentValue)
    }
  }

  private checkRule(rule: AlertRule, target: WatchdogTarget, currentValue: number): void {
    const state = this.triggerStates.get(rule.id) ?? { breached: false, lastNotifiedAt: 0 }
    const isBreached = currentValue > rule.thresholdValue
    const now = Date.now()

    if (isBreached) {
      const shouldNotify = !state.breached || now - state.lastNotifiedAt >= RENOTIFY_COOLDOWN_MS
      if (shouldNotify) {
        state.lastNotifiedAt = now
        this.onAlert({ rule, target, kind: 'triggered', currentValue, timestamp: now })
      }
      state.breached = true
    } else {
      if (state.breached) {
        this.onAlert({ rule, target, kind: 'recovered', currentValue, timestamp: now })
      }
      state.breached = false
      state.lastNotifiedAt = 0
    }

    this.triggerStates.set(rule.id, state)
  }
}
