import type { RangePreset } from '../lib/chart-data'

interface TimeRangeControlsProps {
  rangeMs: number
  onSelectRange: (ms: number) => void
  onResetZoom: () => void
  /** Highlights the reset button so a manual drag-zoom is obvious, not just inferable from the axis. */
  isZoomed?: boolean
  presets: RangePreset[]
}

/**
 * Top-right controls shared by every latency chart: pick how far back to
 * look (also re-fits the chart to that range), or snap back out of a
 * manual drag-zoom without changing the selected range.
 */
function TimeRangeControls({
  rangeMs,
  onSelectRange,
  onResetZoom,
  isZoomed = false,
  presets
}: TimeRangeControlsProps): React.JSX.Element {
  return (
    <div className="time-range-controls">
      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={`time-range-btn ${preset.ms === rangeMs ? 'time-range-btn--active' : ''}`}
          onClick={() => onSelectRange(preset.ms)}
        >
          {preset.label}
        </button>
      ))}
      <button
        type="button"
        className={`time-range-reset-btn ${isZoomed ? 'time-range-reset-btn--active' : ''}`}
        onClick={onResetZoom}
      >
        {isZoomed ? '● Zoomed - reset' : 'Reset zoom'}
      </button>
    </div>
  )
}

export default TimeRangeControls
