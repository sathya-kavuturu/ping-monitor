import type uPlot from 'uplot'

/**
 * Color for "no reply" markers - thin red vertical bars spanning the full
 * plot height at each lost-ping timestamp. Used by the single-series charts
 * (`TimelineChart`, `IndividualLatencyChart`) where there's only one line, so
 * a full-height bar can't be ambiguous about which series lost the packet.
 * `OverviewChart`'s combined (multi-series) view uses
 * `drawPerSeriesLossMarkers` below instead, for exactly that reason.
 */
export const COLOR_LOSS = '#e6543e'

/**
 * Draws one thin vertical bar per lost-ping timestamp across the full plot
 * height, directly on the uPlot canvas - call from a `hooks.draw` callback,
 * which fires after uPlot's own series drawing for the frame, so this
 * layers cleanly on top instead of getting overwritten by it.
 */
export function drawLossMarkers(u: uPlot, lostSeconds: number[]): void {
  const { left, top, width, height } = u.bbox
  if (width <= 0 || height <= 0) return
  const ctx = u.ctx
  ctx.save()
  ctx.fillStyle = COLOR_LOSS
  for (const seconds of lostSeconds) {
    const x = u.valToPos(seconds, 'x', true)
    if (x < left || x > left + width) continue
    ctx.fillRect(Math.round(x) - 1, top, 2, height)
  }
  ctx.restore()
}

/** One series' lost-ping marker, positioned on the specific line it belongs to (see `drawPerSeriesLossMarkers`). */
export interface SeriesLossPoint {
  /** Unix seconds, uPlot's x-axis unit. */
  x: number
  /** The y-value to draw the marker at - see `interpolateAtGap` for why a lost sample needs this computed rather than read directly. */
  y: number
  color: string
}

const MARKER_RADIUS = 4.5
// Matches --bg-elevated (styles.css) - a ring in the chart's own background
// color separates the marker from the line color it sits on top of, the
// same way a scatter point's outline would.
const MARKER_RING_COLOR = '#1b1e27'

/**
 * Draws one small filled circle per lost ping, positioned on the specific
 * series it belongs to - unlike `drawLossMarkers`'s full-height bar, this
 * never marks a series that didn't actually lose anything just because some
 * other series sharing the same x-axis did.
 */
export function drawPerSeriesLossMarkers(u: uPlot, points: SeriesLossPoint[]): void {
  const { left, top, width, height } = u.bbox
  if (width <= 0 || height <= 0) return
  const ctx = u.ctx
  ctx.save()
  for (const point of points) {
    const x = u.valToPos(point.x, 'x', true)
    const y = u.valToPos(point.y, 'y', true)
    if (x < left || x > left + width || y < top || y > top + height) continue
    ctx.beginPath()
    ctx.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = point.color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = MARKER_RING_COLOR
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Approximates the y-value a `spanGaps: true` line visually passes through
 * at a lost (null) index, by linearly interpolating between the nearest
 * non-null neighbors on either side - so the marker sits on the rendered
 * line rather than floating at some unrelated height. Returns `null` only
 * when a series has no non-null value anywhere (nothing to interpolate from).
 */
export function interpolateAtGap(latency: (number | null)[], index: number): number | null {
  let prevIndex = -1
  for (let i = index - 1; i >= 0; i--) {
    if (latency[i] !== null) {
      prevIndex = i
      break
    }
  }
  let nextIndex = -1
  for (let i = index + 1; i < latency.length; i++) {
    if (latency[i] !== null) {
      nextIndex = i
      break
    }
  }
  if (prevIndex === -1 && nextIndex === -1) return null
  if (prevIndex === -1) return latency[nextIndex]
  if (nextIndex === -1) return latency[prevIndex]
  const prevValue = latency[prevIndex] as number
  const nextValue = latency[nextIndex] as number
  const t = (index - prevIndex) / (nextIndex - prevIndex)
  return prevValue + (nextValue - prevValue) * t
}
