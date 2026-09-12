import type uPlot from 'uplot'

/**
 * Formats the x-series' hover/legend value with seconds included - uPlot's
 * default time-axis legend formatting tracks the axis tick format, which
 * drops seconds once the visible range is wide enough, making it impossible
 * to tell exactly which second a hovered point landed on. Shared by every
 * latency chart (`TimelineChart`, `IndividualLatencyChart`, `OverviewChart`)
 * so hovering any of them shows the same precision regardless of zoom level.
 */
export function formatLegendTimestamp(_u: uPlot, rawValue: number | null | undefined): string {
  if (rawValue == null) return '--'
  return new Date(rawValue * 1000).toLocaleTimeString()
}
