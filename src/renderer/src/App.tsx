import { useCallback, useEffect, useState } from 'react'
import type {
  CreateTargetInput,
  NetworkUpdate,
  PingHistoryRecord,
  Target,
  TargetStatus
} from '../../shared/types'
import { CHART_WINDOW_MS } from './lib/chart-data'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import UpdateBanner from './components/UpdateBanner'

export interface TargetWithStatus extends Target {
  status: TargetStatus
}

function App(): React.JSX.Element {
  const [targets, setTargets] = useState<TargetWithStatus[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  // Rolling last-10-minutes buffer per target, ascending by timestamp. Feeds
  // both the timeline chart and the route table - see src/renderer/src/lib.
  const [updatesByTarget, setUpdatesByTarget] = useState<Record<string, NetworkUpdate[]>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const [pingHistory, setPingHistory] = useState<PingHistoryRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    window.api
      .getTargets()
      .then((fetched) => {
        if (cancelled) return
        setTargets(fetched.map((target) => ({ ...target, status: 'online' as TargetStatus })))
        setSelectedTargetId((current) => current ?? fetched[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Failed to load targets')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // onNetworkUpdate returns an unsubscribe function - always clean it up
    // so re-renders/unmounts never leave a dangling ipcRenderer listener.
    const unsubscribe = window.api.onNetworkUpdate((update) => {
      setUpdatesByTarget((prev) => {
        const cutoff = Date.now() - CHART_WINDOW_MS
        const existing = prev[update.targetId] ?? []
        const next = [...existing, update].filter((sample) => sample.timestamp >= cutoff)
        return { ...prev, [update.targetId]: next }
      })
      setTargets((prev) =>
        prev.map((target) =>
          target.id === update.targetId ? { ...target, status: update.status } : target
        )
      )
    })

    return unsubscribe
  }, [])

  const loadPingHistory = useCallback((targetId: string) => {
    setHistoryError(null)
    window.api
      .getPingHistory({ targetId })
      .then(setPingHistory)
      .catch((error: unknown) => {
        setHistoryError(error instanceof Error ? error.message : 'Failed to load ping history')
      })
  }, [])

  useEffect(() => {
    if (!selectedTargetId) {
      setPingHistory([])
      return
    }
    loadPingHistory(selectedTargetId)
  }, [selectedTargetId, loadPingHistory])

  const handleSelectTarget = useCallback((id: string) => {
    setSelectedTargetId(id)
  }, [])

  const handleCreateTarget = useCallback(async (input: CreateTargetInput) => {
    setCreateError(null)
    setIsCreating(true)
    try {
      const target = await window.api.createTarget(input)
      setTargets((prev) => [...prev, { ...target, status: 'online' }])
      setSelectedTargetId(target.id)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create target')
    } finally {
      setIsCreating(false)
    }
  }, [])

  const handleRefreshHistory = useCallback(() => {
    if (selectedTargetId) loadPingHistory(selectedTargetId)
  }, [selectedTargetId, loadPingHistory])

  const selectedTarget = targets.find((target) => target.id === selectedTargetId) ?? null
  const liveUpdates = selectedTargetId ? (updatesByTarget[selectedTargetId] ?? []) : []

  return (
    <div className="app-shell-outer">
      <UpdateBanner />
      <div className="app-shell">
        <Sidebar
          targets={targets}
          selectedTargetId={selectedTargetId}
          onSelectTarget={handleSelectTarget}
          onCreateTarget={handleCreateTarget}
          isCreating={isCreating}
          error={loadError}
          createError={createError}
        />
        <MainContent
          target={selectedTarget}
          liveUpdates={liveUpdates}
          pingHistory={pingHistory}
          historyError={historyError}
          onRefreshHistory={handleRefreshHistory}
        />
      </div>
    </div>
  )
}

export default App
