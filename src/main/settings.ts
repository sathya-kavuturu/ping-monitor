import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/types'

export const DEFAULT_PING_INTERVAL_MS = 1_000
const MIN_PING_INTERVAL_MS = 200
const MAX_PING_INTERVAL_MS = 300_000

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function clampPingIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_PING_INTERVAL_MS
  return Math.min(MAX_PING_INTERVAL_MS, Math.max(MIN_PING_INTERVAL_MS, Math.round(ms)))
}

let cached: AppSettings | null = null

/** Reads settings.json under userData on first call, then serves from memory. */
export function loadSettings(): AppSettings {
  if (cached) return cached
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    cached = { pingIntervalMs: clampPingIntervalMs(parsed.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS) }
  } catch {
    // Missing/corrupt file on first run or a fresh install - fall back silently.
    cached = { pingIntervalMs: DEFAULT_PING_INTERVAL_MS }
  }
  return cached
}

export function setPingIntervalMs(ms: number): AppSettings {
  cached = { pingIntervalMs: clampPingIntervalMs(ms) }
  writeFileSync(settingsPath(), JSON.stringify(cached), 'utf-8')
  return cached
}
