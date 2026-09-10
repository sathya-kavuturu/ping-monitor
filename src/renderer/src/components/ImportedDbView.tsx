import { useCallback, useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { ImportedDbInfo, PingHistoryRecord, Target } from '../../../shared/types'
import { buildPingHistorySeries } from '../lib/ping-history-chart'
import { drawLossMarkers } from '../lib/chart-loss-markers'

const COLOR_LATENCY = '#4f8cff'
const COLOR_AXIS = '#8b91a2'
const COLOR_GRID = 'rgba(255, 255, 255, 0.08)'

// Static, one-shot view of a finished import - not a live cadence, just a
// generous cap so a long-lived export's full history still fits in one
// fetch (matches `queryPingHistory`'s own upper bound).
const MAX_ROWS = 50_000

function buildOptions(width: number, height: number, onDraw: (u: uPlot) => void): uPlot.Options {
  return {
    width,
    height,
    padding: [12, 12, 0, 0],
    scales: {
      x: { time: true },
      y: { range: (_self, _min, max) => [0, Math.max(50, max * 1.2)] }
    },
    axes: [
      { stroke: COLOR_AXIS, grid: { stroke: COLOR_GRID }, ticks: { stroke: COLOR_GRID } },
      {
        scale: 'y',
        label: 'Avg latency (ms)',
        stroke: COLOR_AXIS,
        grid: { stroke: COLOR_GRID },
        ticks: { stroke: COLOR_GRID }
      }
    ],
    series: [
      {},
      {
        label: 'Avg latency',
        scale: 'y',
        stroke: COLOR_LATENCY,
        width: 2,
        spanGaps: true,
        points: { show: false }
      }
    ],
    legend: { show: true },
    cursor: { drag: { x: true, y: false } },
    hooks: { draw: [onDraw] }
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

/**
 * Read-only browser for a database imported via `DbStorageView`'s "Import
 * database…" button (see `main/db/import-export.ts`) - queries a completely
 * separate copy of the file, never the live database, so picking a target
 * here can't collide with or disrupt anything actively being monitored.
 * There's no live tick and no range picker: an import is a fixed snapshot,
 * so the whole thing is just fetched once per target and plotted as-is.
 */
function ImportedDbView(): React.JSX.Element {
  const [info, setInfo] = useState<ImportedDbInfo | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [records, setRecords] = useState<PingHistoryRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const lostSecondsRef = useRef<number[]>([])

  const loadInfoAndTargets = useCallback(() => {
    setError(null)
    Promise.all([window.api.getImportedDbInfo(), window.api.getImportedTargets()])
      .then(([nextInfo, nextTargets]) => {
        setInfo(nextInfo)
        setTargets(nextTargets)
        setSelectedTargetId((current) => current ?? nextTargets[0]?.id ?? null)
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load imported data')
      })
  }, [])

  useEffect(() => {
    loadInfoAndTargets()
  }, [loadInfoAndTargets])

  const handleImport = (): void => {
    setError(null)
    window.api
      .importDatabase()
      .then((result) => {
        if (!result.canceled) loadInfoAndTargets()
      })
      .catch((importError: unknown) => {
        setError(importError instanceof Error ? importError.message : 'Import failed')
      })
  }

  const handleClear = (): void => {
    setIsClearing(true)
    window.api
      .clearImportedDatabase()
      .then(() => {
        setInfo({ sourcePath: null, importedAt: null })
        setTargets([])
        setSelectedTargetId(null)
        setRecords([])
      })
      .catch((clearError: unknown) => {
        setError(clearError instanceof Error ? clearError.message : 'Failed to clear import')
      })
      .finally(() => setIsClearing(false))
  }

  // Plot instance created once, destroyed on unmount - there's no live data
  // to resize/reflow around beyond the container itself, so this is much
  // simpler than the live charts' resize/zoom-sync machinery.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    const plot = new uPlot(
      buildOptions(Math.max(width, 1), Math.max(height, 1), (u) =>
        drawLossMarkers(u, lostSecondsRef.current)
      ),
      [[], []],
      container
    )
    plotRef.current = plot

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0 && (Math.abs(plot.width - w) >= 0.5 || Math.abs(plot.height - h) >= 0.5)) {
        plot.setSize({ width: w, height: h })
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!selectedTargetId) {
      setRecords([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    setError(null)
    window.api
      .getImportedPingHistory({ targetId: selectedTargetId, limit: MAX_ROWS })
      .then((rows) => {
        if (!cancelled) setRecords(rows)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load ping history')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedTargetId])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const series = buildPingHistorySeries(records)
    lostSecondsRef.current = series.lostBucketSeconds
    plot.setData([series.xs, series.avgLatency])
    if (series.xs.length > 0) {
      plot.setScale('x', { min: series.xs[0], max: series.xs[series.xs.length - 1] })
    }
  }, [records])

  const selectedTarget = targets.find((target) => target.id === selectedTargetId) ?? null

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>Imported Data</h1>
      </header>

      {error && <p className="sidebar-error">{error}</p>}

      {!info || !info.sourcePath ? (
        <section className="feed">
          <p className="feed-empty">
            No database imported yet. Import a previously-exported file to browse it here,
            separately from your live monitored targets.
          </p>
          <div className="feed-header-actions" style={{ marginTop: 12 }}>
            <button type="button" className="refresh-btn" onClick={handleImport}>
              Import database…
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Source file</span>
              <span className="stat-value" style={{ fontSize: 13, fontWeight: 400 }}>
                {info.sourcePath}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Imported</span>
              <span className="stat-value" style={{ fontSize: 13, fontWeight: 400 }}>
                {formatDate(info.importedAt)}
              </span>
            </div>
          </section>

          <div className="feed-header-row">
            <h2>Targets in this import</h2>
            <div className="feed-header-actions">
              <button type="button" className="refresh-btn" onClick={handleImport}>
                Import a different file…
              </button>
              <button
                type="button"
                className="refresh-btn"
                onClick={handleClear}
                disabled={isClearing}
              >
                {isClearing ? 'Clearing…' : 'Clear import'}
              </button>
            </div>
          </div>

          {targets.length === 0 ? (
            <p className="feed-empty">This import has no targets.</p>
          ) : (
            <>
              <div className="target-checkbox-list">
                {targets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className={`view-mode-btn ${target.id === selectedTargetId ? 'view-mode-btn--active' : ''}`}
                    onClick={() => setSelectedTargetId(target.id)}
                  >
                    {target.name} ({target.host})
                  </button>
                ))}
              </div>

              <section className="feed">
                <div className="feed-header-row">
                  <h2>{selectedTarget ? `${selectedTarget.name} - Latency` : 'Latency'}</h2>
                  <span className="route-meta">
                    {isLoading ? 'Loading…' : `${records.length.toLocaleString()} rollups`}
                  </span>
                </div>
                <div className="chart-wrap">
                  <div ref={containerRef} className="timeline-chart" />
                </div>
                {!isLoading && records.length === 0 && (
                  <p className="feed-empty">No ping history for this target in the import.</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  )
}

export default ImportedDbView
