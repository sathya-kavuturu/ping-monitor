import type { HopSample, NetworkUpdate, TargetStatus } from '../../shared/types'
import { probeLatency } from './ping-probe'
import { runTraceroute } from './traceroute'
import { resolveHopHostnames } from './reverse-dns'

export interface EngineTarget {
  id: string
  host: string
}

export interface NetworkEngineOptions {
  /** How often each target is pinged. Default 1000ms, per the spec. */
  pingIntervalMs?: number
  /**
   * How often each target's traceroute path is refreshed. Traceroute
   * inherently takes several seconds to tens of seconds (each hop timeout
   * is itself ~1-3s), so it cannot run on the same cadence as ping without
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

const DEFAULT_PING_INTERVAL_MS = 1_000
// Exported so storage-stats.ts can project HopHistory growth without
// duplicating (and risking drift from) this constant - main/index.ts never
// overrides it today, so it's the cadence every target actually runs at.
export const DEFAULT_TRACE_INTERVAL_MS = 30_000
const DEFAULT_DEGRADED_THRESHOLD_MS = 150
// How many evenly-spaced slots a traceroute cadence is divided into for
// staggering - see the comment in track(). Six slots against the 30s default
// spreads targets 5s apart, which is enough to stop their traces overlapping
// without meaningfully delaying any individual target's own cadence.
const TRACE_STAGGER_SLOTS = 6

/**
 * Owns one ping loop + one traceroute loop per monitored target. Callers
 * never see child processes, timers, or the `ping` package - just a
 * structured `NetworkUpdate` per sample via `onSample`.
 */
export class NetworkEngine {
  private readonly states = new Map<string, TargetState>()
  private pingIntervalMs: number
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

  /**
   * Starts monitoring any target not already tracked, stops any no longer
   * present, and restarts (stop + re-track) any existing target whose host
   * changed - an edited target keeps its id, so an id-only diff would
   * otherwise keep silently pinging the old host forever.
   */
  sync(targets: EngineTarget[]): void {
    const nextById = new Map(targets.map((target) => [target.id, target]))

    for (const [id, state] of this.states) {
      const next = nextById.get(id)
      if (!next || next.host !== state.target.host) {
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

  getPingIntervalMs(): number {
    return this.pingIntervalMs
  }

  /**
   * Applies a new ping cadence immediately - re-arms every currently tracked
   * target's timer at the new interval, rather than waiting for the next
   * `sync()` (which only starts/stops targets, not reschedule survivors).
   */
  setPingIntervalMs(ms: number): void {
    if (ms === this.pingIntervalMs) return
    this.pingIntervalMs = ms
    for (const [id, state] of this.states) {
      clearInterval(state.timer)
      state.timer = setInterval(() => void this.tick(id), this.pingIntervalMs)
    }
  }

  private track(target: EngineTarget): void {
    // Stagger each target's first (and, since the schedule is relative to
    // when the previous run finished, its ongoing) traceroute so targets
    // don't all fall due on the same tick. Every target starts with
    // `lastTraceAt: 0`, so `dueForTrace` in tick() would otherwise go true
    // for all of them simultaneously the moment they're tracked - and stay
    // roughly in lockstep every `traceIntervalMs` after that. On Windows,
    // where a trace fans out to many concurrent native ICMP hop probes (see
    // traceroute-windows.ts), several targets' traces landing on the same
    // tick multiplies that concurrency and was observed to queue ordinary
    // ping probes behind it long enough to read as false packet loss.
    const staggerMs =
      ((this.states.size % TRACE_STAGGER_SLOTS) * this.traceIntervalMs) / TRACE_STAGGER_SLOTS
    const state: TargetState = {
      target,
      pingInFlight: false,
      traceInFlight: false,
      lastTraceAt: Date.now() - this.traceIntervalMs + staggerMs,
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
      const resolvedHops = await resolveHopHostnames(hops)
      state.lastHops = resolvedHops
      state.hopsCapturedAt = Date.now()
      this.onTraceroute?.(state.target.id, resolvedHops)
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
