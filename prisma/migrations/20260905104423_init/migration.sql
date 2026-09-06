-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PingHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "targetId" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "lostCount" INTEGER NOT NULL,
    "minLatencyMs" REAL,
    "maxLatencyMs" REAL,
    "avgLatencyMs" REAL,
    "avgThroughput" REAL,
    CONSTRAINT "PingHistory_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HopHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "targetId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "hopNumber" INTEGER NOT NULL,
    "address" TEXT,
    "hostname" TEXT,
    "latencyMs" REAL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HopHistory_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Target_host_key" ON "Target"("host");

-- CreateIndex
CREATE INDEX "PingHistory_targetId_bucketStart_idx" ON "PingHistory"("targetId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "PingHistory_targetId_bucketStart_key" ON "PingHistory"("targetId", "bucketStart");

-- CreateIndex
CREATE INDEX "HopHistory_targetId_capturedAt_idx" ON "HopHistory"("targetId", "capturedAt");

-- CreateIndex
CREATE INDEX "HopHistory_traceId_hopNumber_idx" ON "HopHistory"("traceId", "hopNumber");
