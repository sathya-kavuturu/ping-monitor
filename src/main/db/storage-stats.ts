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
   * A fixed-formula capacity estimate: "if every currently-added target were
   * pinged/traced around the clock (24h/day) for a full 30 days, how much
   * would ping-history + hop-history alone occupy" - NOT "current size plus
   * 30 more days" and NOT derived from today's actual accumulated data.
   * Deliberately uses the constant per-row byte/hop assumptions below rather
   * than an average of real rows, so the only thing that changes it day to
   * day is adding or removing targets - not hostname lengths, hop counts, or
   * how much history has piled up so far. Still an approximation, not a
   * promise (see the note this drives in `DbStorageView`).
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

// Fixed per-row/per-run assumptions the 30-day projection is built from -
// rough sums of the schema's own columns plus SQLite's per-row page
// overhead, not measured from live data. Deliberately NOT replaced by an
// average of real rows once enough accumulate: a live average drifts as
// hostnames/org names/hop counts vary, which made the 30-day figure change
// from one day to the next even with the same targets. Keeping these fixed
// means the estimate only moves when targets are added or removed.
const PING_HISTORY_ROW_BYTES = 120
const HOP_HISTORY_ROW_BYTES = 180
const HOPS_PER_RUN = 12

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

  const [targetCount, pingHistoryCount, hopHistoryCount, alertRuleCount, byteSizes] =
    await Promise.all([
      prisma.target.count(),
      prisma.pingHistory.count(),
      prisma.hopHistory.count(),
      prisma.alertRule.count(),
      queryTableByteSizes()
    ])

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

  const projectedPingHistoryBytes =
    targetCount * PING_HISTORY_ROWS_PER_DAY_PER_TARGET * PROJECTION_DAYS * PING_HISTORY_ROW_BYTES
  const projectedHopHistoryBytes =
    targetCount *
    TRACE_RUNS_PER_DAY_PER_TARGET *
    PROJECTION_DAYS *
    HOPS_PER_RUN *
    HOP_HISTORY_ROW_BYTES

  return {
    fileBytes,
    tables,
    estimatedBytesFor30Days: Math.round(projectedPingHistoryBytes + projectedHopHistoryBytes)
  }
}
