import { useState, type DragEvent } from 'react'
import type { MainView, TargetWithStatus } from '../App'
import ContextMenu from './ContextMenu'

interface SidebarProps {
  isOpen: boolean
  targets: TargetWithStatus[]
  selectedTargetId: string | null
  mainView: MainView
  onSelectTarget: (id: string) => void
  onSelectView: (view: MainView) => void
  onOpenAddTarget: () => void
  onOpenHelp: () => void
  onReorderTargets: (orderedIds: string[]) => void
  onToggleShowInOverview: (target: TargetWithStatus) => void
  onEditTarget: (target: TargetWithStatus) => void
  onDeleteTarget: (target: TargetWithStatus) => void
  error: string | null
}

interface TargetMenuState {
  target: TargetWithStatus
  x: number
  y: number
}

function Sidebar({
  isOpen,
  targets,
  selectedTargetId,
  mainView,
  onSelectTarget,
  onSelectView,
  onOpenAddTarget,
  onOpenHelp,
  onReorderTargets,
  onToggleShowInOverview,
  onEditTarget,
  onDeleteTarget,
  error
}: SidebarProps): React.JSX.Element {
  const [menu, setMenu] = useState<TargetMenuState | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const handleDragStart = (event: DragEvent<HTMLLIElement>, id: string): void => {
    setDraggedId(id)
    // Some browsers (notably Firefox) refuse to start a drag at all unless
    // dataTransfer carries something - Chromium/Electron doesn't strictly
    // need it, but setting it costs nothing and keeps this portable.
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (event: DragEvent<HTMLLIElement>, id: string): void => {
    // Dragover must be prevented for a drop to be allowed to fire at all -
    // that's just how the HTML5 DnD API works, not specific to this list.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverId !== id) setDragOverId(id)
  }

  const handleDrop = (event: DragEvent<HTMLLIElement>, dropId: string): void => {
    event.preventDefault()
    setDragOverId(null)
    if (!draggedId || draggedId === dropId) return

    // Dropping on a row inserts the dragged target right before it -
    // compute that by removing the dragged id, then splicing it back in at
    // wherever the drop target now sits in the shortened list.
    const withoutDragged = targets.filter((target) => target.id !== draggedId)
    const draggedTarget = targets.find((target) => target.id === draggedId)
    const dropIndex = withoutDragged.findIndex((target) => target.id === dropId)
    if (!draggedTarget || dropIndex === -1) return

    const reordered = [
      ...withoutDragged.slice(0, dropIndex),
      draggedTarget,
      ...withoutDragged.slice(dropIndex)
    ]
    onReorderTargets(reordered.map((target) => target.id))
  }

  return (
    <aside className={`sidebar ${isOpen ? '' : 'sidebar--closed'}`} aria-hidden={!isOpen}>
      <h2 className="sidebar-title">Views</h2>
      <ul className="target-list">
        <li>
          <button
            type="button"
            className={`target-item ${mainView === 'alerts' ? 'is-selected' : ''}`}
            onClick={() => onSelectView('alerts')}
          >
            <span className="target-info">
              <span className="target-name">Alerts</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={`target-item ${mainView === 'overview' ? 'is-selected' : ''}`}
            onClick={() => onSelectView('overview')}
          >
            <span className="target-info">
              <span className="target-name">Overview</span>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="target-item" onClick={onOpenHelp}>
            <span className="target-info">
              <span className="target-name">Help</span>
            </span>
          </button>
        </li>
      </ul>

      <h2 className="sidebar-title">Monitored Targets</h2>

      <button type="button" className="add-target-btn" onClick={onOpenAddTarget}>
        + Add Target
      </button>

      {error && <p className="sidebar-error">{error}</p>}
      {!error && targets.length === 0 && <p className="sidebar-empty">No targets yet</p>}

      <ul className="target-list">
        {targets.map((target) => (
          <li
            key={target.id}
            className={`target-row ${draggedId === target.id ? 'target-row--dragging' : ''} ${
              dragOverId === target.id && draggedId !== target.id ? 'target-row--drag-over' : ''
            }`}
            draggable
            onDragStart={(event) => handleDragStart(event, target.id)}
            onDragOver={(event) => handleDragOver(event, target.id)}
            onDragLeave={() => setDragOverId((current) => (current === target.id ? null : current))}
            onDrop={(event) => handleDrop(event, target.id)}
            onDragEnd={() => {
              setDraggedId(null)
              setDragOverId(null)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ target, x: event.clientX, y: event.clientY })
            }}
          >
            <span className="target-drag-handle" aria-hidden="true">
              ⠿
            </span>
            <button
              type="button"
              className={`target-item ${
                mainView === 'target' && target.id === selectedTargetId ? 'is-selected' : ''
              }`}
              onClick={() => onSelectTarget(target.id)}
            >
              <span className={`status-dot status-${target.status}`} aria-hidden="true" />
              <span className="target-info">
                <span className="target-name">{target.name}</span>
                <span className="target-host">{target.host}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Show in Overview',
              checked: menu.target.showInOverview,
              onClick: () => onToggleShowInOverview(menu.target)
            },
            { label: 'Edit', onClick: () => onEditTarget(menu.target) },
            { label: 'Delete', onClick: () => onDeleteTarget(menu.target), danger: true }
          ]}
        />
      )}
    </aside>
  )
}

export default Sidebar
