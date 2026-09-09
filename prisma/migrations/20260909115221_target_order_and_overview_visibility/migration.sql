-- AlterTable
ALTER TABLE "Target" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Target" ADD COLUMN "showInOverview" BOOLEAN NOT NULL DEFAULT true;

-- Backfill sortOrder from insertion order (SQLite's implicit rowid, which
-- for a table with no INTEGER PRIMARY KEY tracks insertion order) so
-- existing targets keep their current relative order after this migration.
UPDATE "Target" SET "sortOrder" = "rowid";
