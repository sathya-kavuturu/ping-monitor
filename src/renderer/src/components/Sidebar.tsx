import { useState } from 'react'
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
  onEditTarget,
  onDeleteTarget,
  error
}: SidebarProps): React.JSX.Element {
  const [menu, setMenu] = useState<TargetMenuState | null>(null)

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
            className="target-row"
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ target, x: event.clientX, y: event.clientY })
            }}
          >
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
            { label: 'Edit', onClick: () => onEditTarget(menu.target) },
            { label: 'Delete', onClick: () => onDeleteTarget(menu.target), danger: true }
          ]}
        />
      )}
    </aside>
  )
}

export default Sidebar
