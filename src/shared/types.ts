export type TargetStatus = 'online' | 'degraded' | 'offline'

/**
 * Mirrors the Prisma `Target` model shape. Kept as a hand-written interface
 * (rather than importing the generated Prisma type) so the renderer bundle
 * never needs to know about `@prisma/client` or the generated client at all.
 */
export interface Target {
  id: string
  name: string
  host: string
  createdAt: Date
}

export interface CreateTargetInput {
  name: string
  host: string
}

/** One hop of a traceroute path - shared shape for the live update and `HopRecord`. */
export interface HopSample {
  hopNumber: number
  /** `null` means this hop never replied (timeout). */
  address: string | null
  hostname: string | null
  latencyMs: number | null
}

/**
 * One live sample, broadcast once per target every ~1 second by the
 * network engine (`src/main/network/engine.ts`). Aggregates the fresh
 * end-to-end ping with the most recently known traceroute path - hop
 * discovery runs on its own slower cadence (real traceroutes take far
 * longer than 1s), so `hops`/`hopsCapturedAt` describe the latest completed
 * run, not a fresh one for every sample.
 */
export interface NetworkUpdate {
  targetId: string
  timestamp: number
  /** `null` means the packet was lost/timed out. */
  latencyMs: number | null
  status: TargetStatus
  hops: HopSample[]
  /** When `hops` was captured, or `null` if no traceroute has completed yet. */
  hopsCapturedAt: number | null
}

/** One row = one aggregated 1-minute rollup window (mirrors `PingHistory`). */
export interface PingHistoryRecord {
  id: number
  targetId: string
  bucketStart: Date
  sampleCount: number
  lostCount: number
  minLatencyMs: number | null
  maxLatencyMs: number | null
  avgLatencyMs: number | null
  /** Reserved for a future bandwidth test - ICMP ping can't measure this, always null today. */
  avgThroughput: number | null
}

export interface PingHistoryQuery {
  targetId: string
  from?: Date
  to?: Date
  limit?: number
}

/** One row = one hop of one traceroute run (mirrors `HopHistory`). */
export interface HopRecord extends HopSample {
  id: number
  targetId: string
  traceId: string
  capturedAt: Date
}

export interface HopHistoryQuery {
  targetId: string
  /** A specific traceroute run; omit to get the most recent run. */
  traceId?: string
  limit?: number
}

/** What an `AlertRule` watches: rolling packet-loss % or rolling avg latency (ms). */
export type AlertMetric = 'packet_loss' | 'latency'

/** Mirrors the Prisma `AlertRule` model shape (see `prisma/schema.prisma`). */
export interface AlertRule {
  id: string
  targetId: string
  metric: AlertMetric
  /** Percent (0-100) for `packet_loss`, milliseconds for `latency`. */
  thresholdValue: number
  enabled: boolean
  createdAt: Date
}

export interface CreateAlertRuleInput {
  targetId: string
  metric: AlertMetric
  thresholdValue: number
}

/**
 * Lifecycle of the app's self-update check, broadcast from main to renderer.
 * `available`'s `version` is what the Update/Cancel dialog shows; `download
 * Update()` moves it into `downloading`, and `downloaded` is momentary -
 * main quits and restarts into the update as soon as it fires.
 */
export type UpdateStatusEvent =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

/**
 * Shape of the API the preload script exposes on `window.api`. Kept in
 * `shared` so main, preload and renderer all type-check against the same
 * contract instead of duplicating (and drifting on) it.
 */
export interface ExposedApi {
  getTargets: () => Promise<Target[]>
  createTarget: (input: CreateTargetInput) => Promise<Target>
  /** Cascade-deletes the target's ping history, hop history, and alert rules too. */
  deleteTarget: (id: string) => Promise<void>
  /** Resolves a DNS name (or IP literal, returned unchanged) to an IP address, or `null` if it can't be resolved. */
  resolveHostname: (host: string) => Promise<string | null>
  getPingHistory: (query: PingHistoryQuery) => Promise<PingHistoryRecord[]>
  getHopHistory: (query: HopHistoryQuery) => Promise<HopRecord[]>
  /** Omit `targetId` to list alert rules across every target (used by the consolidated Alerts view). */
  getAlertRules: (targetId?: string) => Promise<AlertRule[]>
  createAlertRule: (input: CreateAlertRuleInput) => Promise<AlertRule>
  setAlertRuleEnabled: (id: string, enabled: boolean) => Promise<AlertRule>
  deleteAlertRule: (id: string) => Promise<void>
  onNetworkUpdate: (callback: (update: NetworkUpdate) => void) => () => void
  checkForUpdates: () => void
  downloadUpdate: () => void
  onUpdateStatus: (callback: (event: UpdateStatusEvent) => void) => () => void
}
