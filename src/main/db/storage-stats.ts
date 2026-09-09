import { statSync } from 'fs'
import { getDatabasePath, getPrisma } from './client'
import { DEFAULT_TRACE_INTERVAL_MS } from '../network/engine'

export interface DbTableStats {
  table: string
  rowCount: number
  bytes: number
}

export interface DbStorageStats {
  /** Total on-disk size of the database file(s) right now - the main file
   * plus its `-wal`/`-shm` companions if present (WAL-mode writes not yet
   * checkpointed back into the main file still occupy real disk space). */
  fileBytes: number
  tables: DbTableStats[]
  /**
   * A from-scratch capacity estimate - "if today's targets and cadence ran
   * for a full 30 days, roughly how much would ping-history + hop-history
   * alone occupy" - NOT "current size plus 30 more days". Derived from
   * today's average row size (or a documented fallback while a table is
   * still too small to average reliably), so it drifts as hostnames/hop
   * counts vary - deliberately presented as an approximation, not a promise.
   */
  estimatedBytesFor30Days: number
}

// 1-minute rollup buckets, one per target - a fixed rate independent of the
// user's configured ping interval (see `savePingRollup`/`engine.ts`).
const PING_HISTORY_ROWS_PER_DAY_PER_TARGET = 24 * 60

// One traceroute run per target every `DEFAULT_TRACE_INTERVAL_MS`, each run
// producing one HopHistory row per hop.
const TRACE_RUNS_PER_DAY_PER_TARGET = (24 * 60 * 60 * 1000) / DEFAULT_TRACE_INTERVAL_MS

const PROJECTION_DAYS = 30

// Fallback averages (bytes/row, hops/run) for a fresh install where a table
// has too few real rows to average reliably - rough sums of the schema's
// own columns plus SQLite's per-row page overhead, not measured empirically.
const FALLBACK_PING_HISTORY_ROW_BYTES = 120
const FALLBACK_HOP_HISTORY_ROW_BYTES = 180
const FALLBACK_HOPS_PER_RUN = 12

// Below this many rows, an average computed from real data is too noisy to
// trust (e.g. 2 rows including one accidental huge hostname) - fall back to
// the documented estimate instead.
const MIN_ROWS_FOR_RELIABLE_AVERAGE = 20

interface DbstatRow {
  tableName: string
  bytes: bigint | number
}

/**
 * Per-table byte usage straight from SQLite's own page accounting (the
 * `dbstat` virtual table - compiled into better-sqlite3 via
 * SQLITE_ENABLE_DBSTAT_VTAB), with each index's pages rolled up into its
 * owning table so "PingHistory" means the whole table, not just its data
 * pages. Far more accurate than estimating from row count and column types.
 */
async function queryTableByteSizes(): Promise<Map<string, number>> {
  const rows = await getPrisma().$queryRaw<DbstatRow[]>`
    SELECT
      COALESCE(sm.tbl_name, ds.name) AS tableName,
      SUM(ds.pgsize) AS bytes
    FROM dbstat ds
    LEFT JOIN sqlite_master sm ON sm.name = ds.name AND sm.type = 'index'
    GROUP BY tableName
  `
  return new Map(rows.map((row) => [row.tableName, Number(row.bytes)]))
}

function fileSizeBytes(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export async function getDbStorageStats(): Promise<DbStorageStats> {
  const prisma = getPrisma()
  const dbPath = getDatabasePath()

  const fileBytes =
    fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`) + fileSizeBytes(`${dbPath}-shm`)

  const [
    targetCount,
    pingHistoryCount,
    hopHistoryCount,
    alertRuleCount,
    hopHistoryRuns,
    byteSizes
  ] = await Promise.all([
    prisma.target.count(),
    prisma.pingHistory.count(),
    prisma.hopHistory.count(),
    prisma.alertRule.count(),
    prisma.hopHistory.findMany({ distinct: ['traceId'], select: { traceId: true } }),
    queryTableByteSizes()
  ])
  const hopHistoryRunCount = hopHistoryRuns.length

  const knownTables = ['Target', 'PingHistory', 'HopHistory', 'AlertRule']
  const rowCounts: Record<string, number> = {
    Target: targetCount,
    PingHistory: pingHistoryCount,
    HopHistory: hopHistoryCount,
    AlertRule: alertRuleCount
  }

  const tables: DbTableStats[] = knownTables
    .map((table) => ({
      table,
      rowCount: rowCounts[table] ?? 0,
      bytes: byteSizes.get(table) ?? 0
    }))
    .sort((a, b) => b.bytes - a.bytes)

  const avgPingHistoryRowBytes =
    pingHistoryCount >= MIN_ROWS_FOR_RELIABLE_AVERAGE
      ? (byteSizes.get('PingHistory') ?? 0) / pingHistoryCount
      : FALLBACK_PING_HISTORY_ROW_BYTES

  const avgHopHistoryRowBytes =
    hopHistoryCount >= MIN_ROWS_FOR_RELIABLE_AVERAGE
      ? (byteSizes.get('HopHistory') ?? 0) / hopHistoryCount
      : FALLBACK_HOP_HISTORY_ROW_BYTES

  const avgHopsPerRun =
    hopHistoryRunCount >= MIN_ROWS_FOR_RELIABLE_AVERAGE
      ? hopHistoryCount / hopHistoryRunCount
      : FALLBACK_HOPS_PER_RUN

  const projectedPingHistoryBytes =
    targetCount * PING_HISTORY_ROWS_PER_DAY_PER_TARGET * PROJECTION_DAYS * avgPingHistoryRowBytes
  const projectedHopHistoryBytes =
    targetCount *
    TRACE_RUNS_PER_DAY_PER_TARGET *
    PROJECTION_DAYS *
    avgHopsPerRun *
    avgHopHistoryRowBytes

  return {
    fileBytes,
    tables,
    estimatedBytesFor30Days: Math.round(projectedPingHistoryBytes + projectedHopHistoryBytes)
  }
}
