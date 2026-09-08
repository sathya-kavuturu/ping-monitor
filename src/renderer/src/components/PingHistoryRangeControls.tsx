import { HISTORY_RANGE_PRESETS } from '../lib/chart-data'

interface PingHistoryRangeControlsProps {
  rangeMs: number
  onSelectRange: (ms: number) => void
}

/**
 * Day/week/month range picker for the Ping History chart - separate from
 * `TimeRangeControls` (used by the live charts) because it draws from
 * `HISTORY_RANGE_PRESETS`, not `RANGE_PRESETS`, and has no "reset zoom"
 * button (see `PingHistoryChart`'s doc comment for why one isn't needed).
 */
function PingHistoryRangeControls({
  rangeMs,
  onSelectRange
}: PingHistoryRangeControlsProps): React.JSX.Element {
  return (
    <div className="time-range-controls">
      {HISTORY_RANGE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={`time-range-btn ${preset.ms === rangeMs ? 'time-range-btn--active' : ''}`}
          onClick={() => onSelectRange(preset.ms)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}

export default PingHistoryRangeControls
