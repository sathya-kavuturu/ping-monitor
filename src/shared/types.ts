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
  /** User-controlled display order (sidebar list, Overview charts). */
  sortOrder: number
  /** Whether this target appears in the Overview tab's charts. */
  showInOverview: boolean
  createdAt: Date
}

export interface CreateTargetInput {
  name: string
  host: string
}

export interface UpdateTargetInput {
  id: string
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

/** Fetches every hop of the most recent completed traceroute runs captured within `[from, to]` - see `getHopHistoryRange`. */
export interface HopHistoryRangeQuery {
  targetId: string
  from: Date
  to: Date
  /** Caps how many runs within the range are returned (most recent first). Defaults to 20. */
  maxRuns?: number
}

/** One DB table's current row count and on-disk byte usage (see `getDbStorageStats`). */
export interface DbTableStats {
  table: string
  rowCount: number
  bytes: number
}

export interface ExportDatabaseResult {
  /** True if the user dismissed the save dialog without picking a location. */
  canceled: boolean
  path?: string
}

export interface ImportDatabaseResult {
  /** True if the user dismissed the open dialog without picking a file. */
  canceled: boolean
  path?: string
  targetCount?: number
}

/** Whether a database has been imported (see `importDatabase`) and, if so, what/when. */
export interface ImportedDbInfo {
  /** The original file path the user picked to import, or `null` if nothing's been imported (or it was cleared). */
  sourcePath: string | null
  importedAt: string | null
}

/** See `src/main/db/storage-stats.ts` for how each field is derived. */
export interface DbStorageStats {
  /** Total on-disk size of the database file(s) right now. */
  fileBytes: number
  tables: DbTableStats[]
  /**
   * A from-scratch capacity estimate, not "current size plus 30 more days" -
   * approximately how much ping-history + hop-history alone would occupy if
   * today's targets and cadence ran for a full 30 days.
   */
  estimatedBytesFor30Days: number
}

/**
 * Hosting/ownership info for one hop's public IP (ISP, organization, ASN) -
 * looked up on demand per address, not stored on `HopSample`/`HopRecord`
 * (see `src/main/network/ip-hosting.ts`). `null` means the address is
 * private/reserved (never looked up) or the lookup failed/found nothing.
 */
export interface HopHostingInfo {
  isp: string | null
  org: string | null
  asn: string | null
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

/** Persisted app-wide preferences (see `src/main/settings.ts`). */
export interface AppSettings {
  /** How often every target is pinged, applied to all targets uniformly. */
  pingIntervalMs: number
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
  updateTarget: (input: UpdateTargetInput) => Promise<Target>
  /** Cascade-deletes the target's ping history, hop history, and alert rules too. */
  deleteTarget: (id: string) => Promise<void>
  /** Persists a full reordering - `orderedIds` is every target id in its new display order. */
  reorderTargets: (orderedIds: string[]) => Promise<void>
  /** Toggled from the sidebar's right-click menu or the Overview tab's own checkboxes. */
  setTargetShowInOverview: (id: string, showInOverview: boolean) => Promise<Target>
  /** Resolves a DNS name (or IP literal, returned unchanged) to an IP address, or `null` if it can't be resolved. */
  resolveHostname: (host: string) => Promise<string | null>
  /** Looks up hosting/ISP info for a route hop's public IP - see `HopHostingInfo`. */
  resolveHopHosting: (address: string) => Promise<HopHostingInfo | null>
  getPingHistory: (query: PingHistoryQuery) => Promise<PingHistoryRecord[]>
  getHopHistory: (query: HopHistoryQuery) => Promise<HopRecord[]>
  /** The Network Path/Route Table equivalent of `getPingHistory`'s time-range queries - see `HopHistoryRangeQuery`. */
  getHopHistoryRange: (query: HopHistoryRangeQuery) => Promise<HopRecord[]>
  getDbStorageStats: () => Promise<DbStorageStats>
  /** Opens a save dialog and writes a full copy of the live database there. */
  exportDatabase: () => Promise<ExportDatabaseResult>
  /** Opens a file dialog and imports the chosen file as a separate, read-only dataset - never merged into the live database. */
  importDatabase: () => Promise<ImportDatabaseResult>
  getImportedDbInfo: () => Promise<ImportedDbInfo>
  /** Deletes the imported dataset (the app-owned copy, not the user's original file). */
  clearImportedDatabase: () => Promise<void>
  getImportedTargets: () => Promise<Target[]>
  getImportedPingHistory: (query: PingHistoryQuery) => Promise<PingHistoryRecord[]>
  /** Omit `targetId` to list alert rules across every target (used by the consolidated Alerts view). */
  getAlertRules: (targetId?: string) => Promise<AlertRule[]>
  createAlertRule: (input: CreateAlertRuleInput) => Promise<AlertRule>
  setAlertRuleEnabled: (id: string, enabled: boolean) => Promise<AlertRule>
  deleteAlertRule: (id: string) => Promise<void>
  onNetworkUpdate: (callback: (update: NetworkUpdate) => void) => () => void
  getSettings: () => Promise<AppSettings>
  /** Applies (and persists) a new ping cadence, in milliseconds, to every target. */
  setPingIntervalMs: (ms: number) => Promise<AppSettings>
  checkForUpdates: () => void
  downloadUpdate: () => void
  onUpdateStatus: (callback: (event: UpdateStatusEvent) => void) => () => void
  /**
   * Sets the whole window's page zoom factor (1 = 100%) - used by the
   * Overview tab's "Fit all in view" to shrink everything just enough that
   * every individual target's graph fits without scrolling, the same effect
   * as pressing Ctrl/Cmd+- repeatedly but computed in one step.
   */
  setZoomFactor: (factor: number) => void
}
