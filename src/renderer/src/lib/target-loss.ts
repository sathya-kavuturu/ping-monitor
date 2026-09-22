import type { NetworkUpdate } from '../../../shared/types'

/**
 * How far back "recent loss" looks - a time window rather than a fixed
 * sample count so it stays meaningful regardless of the configured ping
 * interval (see `ping-interval-setting`). Long enough to smooth over a
 * single lost packet, short enough that a target which has genuinely
 * recovered goes back to normal within about a minute - "colored until
 * there is loss" means the window itself, not any separate timer, decides
 * when the color clears.
 */
export const RECENT_LOSS_WINDOW_MS = 60_000

/** Below this many samples in the window, a percentage is noise (one lost
 * packet out of two looks like 50%) - mirrors the watchdog's own MIN_SAMPLES. */
const MIN_SAMPLES = 5

export type LossSeverity = 'none' | 'warning' | 'serious' | 'critical'

/**
 * Rolling loss percentage for one target over the last `RECENT_LOSS_WINDOW_MS`,
 * or `null` when there isn't yet enough recent data to say anything ("just
 * added" or "paused" shouldn't read as 0% clean).
 */
export function computeRecentLossPercent(updates: NetworkUpdate[], now: number): number | null {
  const cutoff = now - RECENT_LOSS_WINDOW_MS
  const recent = updates.filter((update) => update.timestamp >= cutoff)
  if (recent.length < MIN_SAMPLES) return null

  const lostCount = recent.filter((update) => update.latencyMs === null).length
  return (100 * lostCount) / recent.length
}

/**
 * Maps a loss percentage to a severity tier for the sidebar's loss badge.
 * Thresholds are ordinary networking rules of thumb: under 5% is the kind of
 * loss most links shrug off, 5-15% is noticeable, above that is severe.
 */
export function lossSeverity(percent: number | null): LossSeverity {
  if (percent === null || percent <= 0) return 'none'
  if (percent < 5) return 'warning'
  if (percent < 15) return 'serious'
  return 'critical'
}
