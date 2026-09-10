import { app, dialog, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient, type Target } from '../../generated/prisma/client'
import type { PingHistoryQuery, PingHistoryRecord } from '../../shared/types'
import { getDatabasePath, getMigrationsDir, getPrisma } from './client'
import { runMigrations } from './migrate'
import { queryPingHistory } from './ping-history'

/**
 * Imported files are copied here rather than queried in place, for two
 * reasons: the copy can be freely migrated to today's schema (an export
 * from an older app version won't have every current column/table) without
 * ever touching the user's original file, and it gives this module one
 * stable path to keep a long-lived read connection open against.
 */
function importedDbPath(): string {
  return join(app.getPath('userData'), 'imported.db')
}

function importedMetaPath(): string {
  return join(app.getPath('userData'), 'imported-db-meta.json')
}

interface ImportedDbMeta {
  sourcePath: string
  importedAt: string
}

export interface ImportedDbInfo {
  /** The original file path the user picked to import, or `null` if nothing's been imported (or it was cleared). */
  sourcePath: string | null
  importedAt: string | null
}

function loadImportedMeta(): ImportedDbMeta | null {
  try {
    return JSON.parse(readFileSync(importedMetaPath(), 'utf-8')) as ImportedDbMeta
  } catch {
    return null
  }
}

function unlinkIfExists(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Not present - fine, that's the goal either way.
  }
}

function removeDatabaseFiles(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) unlinkIfExists(path + suffix)
}

export function getImportedDbInfo(): ImportedDbInfo {
  if (!existsSync(importedDbPath())) return { sourcePath: null, importedAt: null }
  const meta = loadImportedMeta()
  return { sourcePath: meta?.sourcePath ?? null, importedAt: meta?.importedAt ?? null }
}

// Lazily created, long-lived - re-created only when a new import replaces
// the underlying file (see `importDatabase`/`clearImportedDatabase`).
let importedPrisma: PrismaClient | null = null

async function closeImportedPrisma(): Promise<void> {
  if (importedPrisma) {
    await importedPrisma.$disconnect()
    importedPrisma = null
  }
}

function getImportedPrisma(): PrismaClient {
  if (!importedPrisma) {
    const adapter = new PrismaBetterSqlite3({ url: `file:${importedDbPath()}` })
    importedPrisma = new PrismaClient({ adapter })
  }
  return importedPrisma
}

export interface ExportDatabaseResult {
  canceled: boolean
  path?: string
}

/**
 * Exports the LIVE database (every table - targets, ping history, hop
 * history, alert rules) as a single portable `.db` file the user picks a
 * destination for.
 */
export async function exportDatabase(window: BrowserWindow): Promise<ExportDatabaseResult> {
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Export Database',
    defaultPath: `ping-monitor-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  })
  if (canceled || !filePath) return { canceled: true }

  // Flush any writes still sitting in the WAL file back into the main
  // database file - a plain file copy of just the main file would
  // otherwise silently miss whatever hasn't been checkpointed yet.
  await getPrisma().$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);')
  copyFileSync(getDatabasePath(), filePath)

  return { canceled: false, path: filePath }
}

export interface ImportDatabaseResult {
  canceled: boolean
  path?: string
  targetCount?: number
}

/**
 * Imports a previously-exported `.db` file as a separate, read-only dataset
 * (see `importedDbPath`) - never merged into the live database, so it can't
 * collide with or disrupt whatever's actively being monitored. Viewed via
 * `listImportedTargets`/`getImportedPingHistory`.
 */
export async function importDatabase(window: BrowserWindow): Promise<ImportDatabaseResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Import Database',
    properties: ['openFile'],
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  })
  if (canceled || filePaths.length === 0) return { canceled: true }
  const sourcePath = filePaths[0]

  await closeImportedPrisma()

  const destPath = importedDbPath()
  removeDatabaseFiles(destPath)
  copyFileSync(sourcePath, destPath)

  // Bring the copy up to the CURRENT schema, then sanity-check it actually
  // looks like a Ping Monitor export (has a Target table) before this ever
  // gets queried as one - catches "picked a random unrelated .db file" and
  // "not a SQLite file at all" the same way.
  let targetCount: number
  try {
    const conn = new Database(destPath)
    try {
      runMigrations(conn, getMigrationsDir())
      const row = conn.prepare('SELECT COUNT(*) AS count FROM Target').get() as { count: number }
      targetCount = row.count
    } finally {
      conn.close()
    }
  } catch {
    removeDatabaseFiles(destPath)
    throw new Error(
      "That file doesn't look like a Ping Monitor database export - couldn't find its tables."
    )
  }

  const meta: ImportedDbMeta = { sourcePath, importedAt: new Date().toISOString() }
  writeFileSync(importedMetaPath(), JSON.stringify(meta), 'utf-8')

  return { canceled: false, path: sourcePath, targetCount }
}

/** Forgets the imported dataset - deletes the app-owned copy, not the user's original file. */
export async function clearImportedDatabase(): Promise<void> {
  await closeImportedPrisma()
  removeDatabaseFiles(importedDbPath())
  unlinkIfExists(importedMetaPath())
}

export async function listImportedTargets(): Promise<Target[]> {
  if (!existsSync(importedDbPath())) return []
  return getImportedPrisma().target.findMany({ orderBy: { sortOrder: 'asc' } })
}

export async function getImportedPingHistory(
  query: PingHistoryQuery
): Promise<PingHistoryRecord[]> {
  if (!existsSync(importedDbPath())) return []
  return queryPingHistory(getImportedPrisma(), query)
}
