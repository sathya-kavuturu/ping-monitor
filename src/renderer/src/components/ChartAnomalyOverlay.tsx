import { useState } from 'react'

export interface AnomalyMarker {
  key: string
  /** CSS pixel position within the chart's `.chart-wrap` container. */
  left: number
  top: number
  targetLabel: string
  timestampSec: number
  lossPercent: number
  othersAvgLossPercent: number
  latencyMs: number | null
}

interface ChartAnomalyOverlayProps {
  markers: AnomalyMarker[]
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function formatTime(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleTimeString(undefined, { hour12: false })
}

/**
 * Red dots marking packet-loss anomalies (see `detectPacketLossAnomalies`)
 * over a uPlot chart - rendered as an absolutely-positioned HTML overlay
 * (not a uPlot series/plugin) so each dot can carry its own hover tooltip,
 * matching the pattern `PathVisualization` uses for its hop tooltips. The
 * host chart component owns computing pixel positions (via uPlot's
 * `valToPos`, recomputed on its `draw` hook) and passes the finished list in.
 */
function ChartAnomalyOverlay({ markers }: ChartAnomalyOverlayProps): React.JSX.Element {
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const hovered = markers.find((marker) => marker.key === hoverKey) ?? null

  return (
    <>
      {markers.map((marker) => (
        <div
          key={marker.key}
          className="chart-anomaly-dot"
          style={{ left: marker.left, top: marker.top }}
          onMouseEnter={() => setHoverKey(marker.key)}
          onMouseLeave={() => setHoverKey((key) => (key === marker.key ? null : key))}
        />
      ))}

      {hovered && (
        <div
          className="chart-anomaly-tooltip"
          style={{ left: hovered.left, top: hovered.top }}
        >
          <div className="path-tooltip-header">
            <span className="path-node-dot path-node-dot--mini status-offline" />
            Packet loss spike
          </div>
          <div className="path-tooltip-row">
            <span>Target</span>
            <span>{hovered.targetLabel}</span>
          </div>
          <div className="path-tooltip-row">
            <span>Time</span>
            <span>{formatTime(hovered.timestampSec)}</span>
          </div>
          <div className="path-tooltip-row">
            <span>Loss</span>
            <span>{hovered.lossPercent}%</span>
          </div>
          <div className="path-tooltip-row">
            <span>Other targets</span>
            <span>{hovered.othersAvgLossPercent}%</span>
          </div>
          <div className="path-tooltip-row">
            <span>Latency</span>
            <span>{formatMs(hovered.latencyMs)}</span>
          </div>
        </div>
      )}
    </>
  )
}

export default ChartAnomalyOverlay
