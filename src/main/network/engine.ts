import type { HopSample, NetworkUpdate, TargetStatus } from '../../shared/types'
import { probeLatency } from './ping-probe'
import { runTraceroute } from './traceroute'

export interface EngineTarget {
  id: string
  host: string
}

export interface NetworkEngineOptions {
  /** How often each target is pinged. Default 2000ms, per the spec. */
  pingIntervalMs?: number
  /**
   * How often each target's traceroute path is refreshed. Traceroute
   * inherently takes several seconds to tens of seconds (each hop timeout
   * is itself ~2s), so it cannot run on the same 2s cadence as ping without
   * runs piling up - it's decoupled onto its own, much slower, timer.
   * Default 30_000ms.
   */
  traceIntervalMs?: number
  /** Latency above this marks a target 'degraded' rather than 'online'. */
  degradedThresholdMs?: number
  /** Called for every ping sample, aggregated with the last known hop path. */
  onSample: (update: NetworkUpdate) => void
  /** Called whenever a traceroute run for a target finishes. */
  onTraceroute?: (targetId: string, hops: HopSample[]) => void
}

interface TargetState {
  target: EngineTarget
  timer: ReturnType<typeof setInterval>
  pingInFlight: boolean
  traceInFlight: boolean
  lastTraceAt: number
  lastHops: HopSample[]
  hopsCapturedAt: number | null
}

const DEFAULT_PING_INTERVAL_MS = 2_000
const DEFAULT_TRACE_INTERVAL_MS = 30_000
const DEFAULT_DEGRADED_THRESHOLD_MS = 150

/**
 * Owns one ping loop + one traceroute loop per monitored target. Callers
 * never see child processes, timers, or the `ping` package - just a
 * structured `NetworkUpdate` per sample via `onSample`.
 */
export class NetworkEngine {
  private readonly states = new Map<string, TargetState>()
  private readonly pingIntervalMs: number
  private readonly traceIntervalMs: number
  private readonly degradedThresholdMs: number
  private readonly onSample: NetworkEngineOptions['onSample']
  private readonly onTraceroute: NetworkEngineOptions['onTraceroute']

  constructor(options: NetworkEngineOptions) {
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS
    this.traceIntervalMs = options.traceIntervalMs ?? DEFAULT_TRACE_INTERVAL_MS
    this.degradedThresholdMs = options.degradedThresholdMs ?? DEFAULT_DEGRADED_THRESHOLD_MS
    this.onSample = options.onSample
    this.onTraceroute = options.onTraceroute
  }

  /** Starts monitoring any target not already tracked, stops any no longer present. */
  sync(targets: EngineTarget[]): void {
    const nextIds = new Set(targets.map((target) => target.id))

    for (const [id, state] of this.states) {
      if (!nextIds.has(id)) {
        clearInterval(state.timer)
        this.states.delete(id)
      }
    }

    for (const target of targets) {
      if (!this.states.has(target.id)) {
        this.track(target)
      }
    }
  }

  stopAll(): void {
    for (const state of this.states.values()) {
      clearInterval(state.timer)
    }
    this.states.clear()
  }

  private track(target: EngineTarget): void {
    const state: TargetState = {
      target,
      pingInFlight: false,
      traceInFlight: false,
      lastTraceAt: 0,
      lastHops: [],
      hopsCapturedAt: null,
      timer: setInterval(() => void this.tick(target.id), this.pingIntervalMs)
    }
    this.states.set(target.id, state)
    // Don't make the UI wait a full interval for the first sample.
    void this.tick(target.id)
  }

  private async tick(targetId: string): Promise<void> {
    const state = this.states.get(targetId)
    if (!state) return

    // Guard against a slow probe still running when the next tick fires -
    // skip rather than pile up overlapping pings for the same target.
    if (!state.pingInFlight) {
      state.pingInFlight = true
      this.runPing(state).finally(() => {
        state.pingInFlight = false
      })
    }

    const dueForTrace = Date.now() - state.lastTraceAt >= this.traceIntervalMs
    if (dueForTrace && !state.traceInFlight) {
      state.traceInFlight = true
      state.lastTraceAt = Date.now()
      this.runTrace(state).finally(() => {
        state.traceInFlight = false
      })
    }
  }

  private async runPing(state: TargetState): Promise<void> {
    const latencyMs = await probeLatency(state.target.host)

    const update: NetworkUpdate = {
      targetId: state.target.id,
      timestamp: Date.now(),
      latencyMs,
      status: this.deriveStatus(latencyMs),
      hops: state.lastHops,
      hopsCapturedAt: state.hopsCapturedAt
    }
    this.onSample(update)
  }

  private async runTrace(state: TargetState): Promise<void> {
    try {
      const hops = await runTraceroute(state.target.host)
      state.lastHops = hops
      state.hopsCapturedAt = Date.now()
      this.onTraceroute?.(state.target.id, hops)
    } catch (error) {
      console.error(`Traceroute failed for ${state.target.host}:`, error)
    }
  }

  private deriveStatus(latencyMs: number | null): TargetStatus {
    if (latencyMs === null) return 'offline'
    if (latencyMs > this.degradedThresholdMs) return 'degraded'
    return 'online'
  }
}
