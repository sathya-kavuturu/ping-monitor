import type uPlot from 'uplot'

// How far one wheel "notch" pans, as a fraction of the currently visible
// span - proportional rather than a fixed number of seconds, so a
// zoomed-in view pans in small steps and a wide view pans in big ones.
const PAN_STEP_FRACTION = 0.15

/**
 * Wires mouse-wheel scrolling on a uPlot chart to pan its x-axis left/right,
 * instead of the browser's default page-scroll. This is deliberately a
 * separate gesture from drag-select (uPlot's built-in `cursor.drag`, already
 * used everywhere for "select a portion to zoom into") - scrolling shifts
 * the same-width window sideways, dragging changes how much time is shown.
 *
 * Returns an unsubscribe function - call it from the same effect's cleanup
 * that destroys the plot.
 */
export function attachWheelPan(plot: uPlot): () => void {
  const target = plot.over

  const onWheel = (event: WheelEvent): void => {
    const { min, max } = plot.scales.x
    if (min == null || max == null) return
    // Without this, the wheel event also scrolls the page behind the chart.
    event.preventDefault()

    const span = max - min
    // A plain vertical wheel (what every mouse has, unlike a horizontal
    // tilt-wheel) is what "scroll" means here - deltaY > 0 (scrolling
    // down/forward) pans forward in time, matching how a horizontal
    // timeline naturally reads left-to-right.
    const step = span * PAN_STEP_FRACTION * Math.sign(event.deltaY)
    let nextMin = min + step
    let nextMax = max + step

    // Never pan past "now" into pure empty future space.
    const nowSec = Date.now() / 1000
    if (nextMax > nowSec) {
      const overshoot = nextMax - nowSec
      nextMin -= overshoot
      nextMax -= overshoot
    }

    plot.setScale('x', { min: nextMin, max: nextMax })
  }

  target.addEventListener('wheel', onWheel, { passive: false })
  return () => target.removeEventListener('wheel', onWheel)
}

/**
 * Whether a chart's current x-scale counts as "the user has taken manual
 * control of the view" - true for a drag-zoomed-in span, but ALSO true for a
 * same-width view that's been wheel-panned away from the live edge. Without
 * the second half, panning back in time would immediately get overwritten:
 * the live-mode data-tick effect in every chart component re-snaps to
 * `[now - rangeMs, now]` whenever it thinks nothing is "zoomed", and a plain
 * pan doesn't shrink the span the way a drag-zoom does.
 */
export function isManuallyPositioned(min: number, max: number, fullSpanSec: number): boolean {
  const zoomedIn = max - min < fullSpanSec - 1
  // >2s of slack (not just >1, like the zoom check above) - unlike
  // `zoomedIn`, which compares two values uPlot computed at the same
  // instant, this reads `Date.now()` independently, a moment after `max`
  // was set by a fresh fitToRange() - without the extra margin, that alone
  // could occasionally misread a just-reset live chart as still panned.
  const pannedAwayFromNow = Date.now() / 1000 - max > 2
  return zoomedIn || pannedAwayFromNow
}
