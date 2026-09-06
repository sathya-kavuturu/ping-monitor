interface SparklineProps {
  /** Oldest first, one per retained run - `null` = lost/silent that run. */
  values: (number | null)[]
  /** Latency (ms) that maps to full bar height - anything higher is clamped. */
  capMs?: number
}

const WIDTH = 90
const HEIGHT = 22
const GAP = 1
const DEGRADED_MS = 150

/**
 * PingPlotter-style per-hop trend strip: one bar per retained traceroute
 * run, height by latency, color by health (green/amber/red for a reply,
 * a short red stub for a loss) - a glance at recent stability without
 * needing the full timeline chart.
 */
function Sparkline({ values, capMs = 200 }: SparklineProps): React.JSX.Element {
  if (values.length === 0) {
    return <span className="sparkline-empty">—</span>
  }

  const barWidth = Math.max(WIDTH / values.length - GAP, 1)

  return (
    <svg
      className="sparkline"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Recent latency and packet loss trend"
    >
      {values.map((value, index) => {
        const x = index * (barWidth + GAP)
        const lost = value === null
        const heightFrac = lost ? 0.25 : Math.min(1, Math.max(value / capMs, 0.08))
        const barHeight = HEIGHT * heightFrac
        const color = lost
          ? 'var(--offline)'
          : value > DEGRADED_MS
            ? 'var(--degraded)'
            : 'var(--online)'

        return (
          <rect
            key={index}
            x={x}
            y={HEIGHT - barHeight}
            width={barWidth}
            height={barHeight}
            fill={color}
            opacity={lost ? 0.6 : 0.9}
          />
        )
      })}
    </svg>
  )
}

export default Sparkline
