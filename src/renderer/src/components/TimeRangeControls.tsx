import { RANGE_PRESETS } from '../lib/chart-data'

interface TimeRangeControlsProps {
  rangeMs: number
  onSelectRange: (ms: number) => void
  onResetZoom: () => void
}

/**
 * Top-right controls shared by the latency/loss charts: pick how far back
 * to look (also re-fits the chart to that range), or snap back out of a
 * manual drag-zoom without changing the selected range.
 */
function TimeRangeControls({
  rangeMs,
  onSelectRange,
  onResetZoom
}: TimeRangeControlsProps): React.JSX.Element {
  return (
    <div className="time-range-controls">
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={`time-range-btn ${preset.ms === rangeMs ? 'time-range-btn--active' : ''}`}
          onClick={() => onSelectRange(preset.ms)}
        >
          {preset.label}
        </button>
      ))}
      <button type="button" className="time-range-reset-btn" onClick={onResetZoom}>
        Reset zoom
      </button>
    </div>
  )
}

export default TimeRangeControls
