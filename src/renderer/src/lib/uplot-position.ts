import uPlot from 'uplot'

/**
 * uPlot's `valToPos(val, scaleKey, false)` returns a CSS-pixel offset
 * relative to the plotting rect's own top-left, not the chart's outer
 * container (which also includes axis/label space) - this is that rect's
 * offset within the container, so callers can add it back in to get a
 * position they can use for an absolutely-positioned overlay sibling.
 */
export function plotOffsetCss(plot: uPlot): { left: number; top: number } {
  return { left: plot.bbox.left / uPlot.pxRatio, top: plot.bbox.top / uPlot.pxRatio }
}
