import type Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Applies any `migration.sql` under a `prisma/migrations` subfolder that
 * hasn't run yet, tracked in a small `_app_migrations` table. This stands in
 * for `prisma migrate deploy` - a packaged Electron app has no Prisma CLI
 * (and no shadow database) available at runtime, so migrations are applied
 * by hand against the very SQL files `prisma migrate dev` already generated.
 */
export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS _app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db
      .prepare<[], { name: string }>('SELECT name FROM _app_migrations')
      .all()
      .map((row) => row.name)
  )

  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const folder of migrationFolders) {
    if (applied.has(folder)) continue

    const sql = readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf-8')

    const applyMigration = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _app_migrations (name) VALUES (?)').run(folder)
    })
    applyMigration()
  }
}
