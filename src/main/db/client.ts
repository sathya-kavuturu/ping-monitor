import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../generated/prisma/client'
import { runMigrations } from './migrate'

let prisma: PrismaClient | null = null

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'app.db')
}

export function getMigrationsDir(): string {
  // `prisma/migrations` is shipped alongside the app code (see
  // electron-builder.yml `files`), so this resolves the same way in dev
  // (project root) and in a packaged build (app.asar root).
  return join(app.getAppPath(), 'prisma', 'migrations')
}

/**
 * Applies pending migrations on a short-lived connection, then hands a
 * fresh one to Prisma's better-sqlite3 adapter. Call once at app startup,
 * before any repository function runs.
 */
export function initDatabase(): PrismaClient {
  if (prisma) return prisma

  const dbPath = getDatabasePath()

  const migrationConnection = new Database(dbPath)
  try {
    runMigrations(migrationConnection, getMigrationsDir())
  } finally {
    migrationConnection.close()
  }

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
  prisma = new PrismaClient({ adapter })
  return prisma
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('Database not initialized - call initDatabase() before using it')
  }
  return prisma
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}
