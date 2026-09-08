import { useCallback, useEffect, useState } from 'react'
import type {
  CreateTargetInput,
  NetworkUpdate,
  PingHistoryRecord,
  Target,
  TargetStatus,
  UpdateTargetInput
} from '../../shared/types'
import { CHART_WINDOW_MS, DEFAULT_HISTORY_RANGE_MS } from './lib/chart-data'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import AllAlerts from './components/AllAlerts'
import OverviewChart from './components/OverviewChart'
import UpdateDialog from './components/UpdateDialog'
import AddTargetDialog from './components/AddTargetDialog'
import EditTargetDialog from './components/EditTargetDialog'
import ConfirmDialog from './components/ConfirmDialog'

export interface TargetWithStatus extends Target {
  status: TargetStatus
}

/** Which top-level view fills the main content area, picked from the sidebar. */
export type MainView = 'target' | 'alerts' | 'overview'

function App(): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mainView, setMainView] = useState<MainView>('target')
  const [targets, setTargets] = useState<TargetWithStatus[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  // Rolling last-10-minutes buffer per target, ascending by timestamp. Feeds
  // both the timeline chart and the route table - see src/renderer/src/lib.
  const [updatesByTarget, setUpdatesByTarget] = useState<Record<string, NetworkUpdate[]>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [editingTarget, setEditingTarget] = useState<TargetWithStatus | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<TargetWithStatus | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [pingHistory, setPingHistory] = useState<PingHistoryRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyRangeMs, setHistoryRangeMs] = useState(DEFAULT_HISTORY_RANGE_MS)

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

  const loadPingHistory = useCallback((targetId: string, rangeMs: number) => {
    setHistoryError(null)
    const to = new Date()
    const from = new Date(to.getTime() - rangeMs)
    window.api
      .getPingHistory({ targetId, from, to })
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
    loadPingHistory(selectedTargetId, historyRangeMs)
  }, [selectedTargetId, historyRangeMs, loadPingHistory])

  const handleSelectHistoryRange = useCallback((rangeMs: number) => {
    setHistoryRangeMs(rangeMs)
  }, [])

  const handleSelectTarget = useCallback((id: string) => {
    setSelectedTargetId(id)
    setMainView('target')
  }, [])

  const handleSelectView = useCallback((view: MainView) => {
    setMainView(view)
  }, [])

  const handleCreateTarget = useCallback(async (input: CreateTargetInput) => {
    setCreateError(null)
    setIsCreating(true)
    try {
      const target = await window.api.createTarget(input)
      setTargets((prev) => [...prev, { ...target, status: 'online' }])
      setSelectedTargetId(target.id)
      setMainView('target')
      setIsAddDialogOpen(false)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create target')
    } finally {
      setIsCreating(false)
    }
  }, [])

  const handleOpenAddTarget = useCallback(() => {
    setCreateError(null)
    setIsAddDialogOpen(true)
  }, [])

  const handleCloseAddTarget = useCallback(() => {
    setIsAddDialogOpen(false)
    setCreateError(null)
  }, [])

  const handleOpenEditTarget = useCallback((target: TargetWithStatus) => {
    setUpdateError(null)
    setEditingTarget(target)
  }, [])

  const handleCloseEditTarget = useCallback(() => {
    setEditingTarget(null)
    setUpdateError(null)
  }, [])

  const handleUpdateTarget = useCallback(async (input: UpdateTargetInput) => {
    setUpdateError(null)
    setIsUpdating(true)
    try {
      const target = await window.api.updateTarget(input)
      setTargets((prev) => prev.map((t) => (t.id === target.id ? { ...t, ...target } : t)))
      setEditingTarget(null)
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Failed to update target')
    } finally {
      setIsUpdating(false)
    }
  }, [])

  const handleRequestDeleteTarget = useCallback((target: TargetWithStatus) => {
    setDeleteError(null)
    setPendingDeleteTarget(target)
  }, [])

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteTarget(null)
    setDeleteError(null)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteTarget) return
    const deletedId = pendingDeleteTarget.id

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await window.api.deleteTarget(deletedId)
      setTargets((prev) => prev.filter((target) => target.id !== deletedId))
      setUpdatesByTarget((prev) => {
        const next = { ...prev }
        delete next[deletedId]
        return next
      })
      setSelectedTargetId((current) => {
        if (current !== deletedId) return current
        const remaining = targets.filter((target) => target.id !== deletedId)
        return remaining[0]?.id ?? null
      })
      setPendingDeleteTarget(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete target')
    } finally {
      setIsDeleting(false)
    }
  }, [pendingDeleteTarget, targets])

  const handleRefreshHistory = useCallback(() => {
    if (selectedTargetId) loadPingHistory(selectedTargetId, historyRangeMs)
  }, [selectedTargetId, historyRangeMs, loadPingHistory])

  const selectedTarget = targets.find((target) => target.id === selectedTargetId) ?? null
  const liveUpdates = selectedTargetId ? (updatesByTarget[selectedTargetId] ?? []) : []

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'app-shell--sidebar-closed'}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((open) => !open)}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={sidebarOpen}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M2 3.5h12M2 8h12M2 12.5h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <Sidebar
        isOpen={sidebarOpen}
        targets={targets}
        selectedTargetId={selectedTargetId}
        mainView={mainView}
        onSelectTarget={handleSelectTarget}
        onSelectView={handleSelectView}
        onOpenAddTarget={handleOpenAddTarget}
        onEditTarget={handleOpenEditTarget}
        onDeleteTarget={handleRequestDeleteTarget}
        error={loadError}
      />
      {mainView === 'target' && (
        <MainContent
          target={selectedTarget}
          liveUpdates={liveUpdates}
          pingHistory={pingHistory}
          historyError={historyError}
          onRefreshHistory={handleRefreshHistory}
          historyRangeMs={historyRangeMs}
          onSelectHistoryRange={handleSelectHistoryRange}
        />
      )}
      {mainView === 'alerts' && <AllAlerts targets={targets} />}
      {mainView === 'overview' && (
        <OverviewChart targets={targets} updatesByTarget={updatesByTarget} />
      )}
      <UpdateDialog />
      {isAddDialogOpen && (
        <AddTargetDialog
          onCreateTarget={handleCreateTarget}
          isCreating={isCreating}
          error={createError}
          onClose={handleCloseAddTarget}
        />
      )}
      {editingTarget && (
        <EditTargetDialog
          target={editingTarget}
          onUpdateTarget={handleUpdateTarget}
          isUpdating={isUpdating}
          error={updateError}
          onClose={handleCloseEditTarget}
        />
      )}
      {pendingDeleteTarget && (
        <ConfirmDialog
          title="Delete Target"
          message={`Delete "${pendingDeleteTarget.name}" (${pendingDeleteTarget.host})? This removes its ping history, path data, and alert rules. This cannot be undone.`}
          isConfirming={isDeleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}
    </div>
  )
}

export default App
