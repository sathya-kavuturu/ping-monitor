import type uPlot from 'uplot'

/**
 * Color for "no reply" markers - thin red vertical bars spanning the full
 * plot height at each lost-ping timestamp. Shared across every latency
 * chart (`TimelineChart`, `IndividualLatencyChart`, `OverviewChart`'s
 * combined view) so a lost ping reads the same way everywhere.
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
