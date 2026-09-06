import type { MainView, TargetWithStatus } from '../App'

interface SidebarProps {
  isOpen: boolean
  targets: TargetWithStatus[]
  selectedTargetId: string | null
  mainView: MainView
  onSelectTarget: (id: string) => void
  onSelectView: (view: MainView) => void
  onOpenAddTarget: () => void
  onDeleteTarget: (target: TargetWithStatus) => void
  error: string | null
}

function Sidebar({
  isOpen,
  targets,
  selectedTargetId,
  mainView,
  onSelectTarget,
  onSelectView,
  onOpenAddTarget,
  onDeleteTarget,
  error
}: SidebarProps): React.JSX.Element {
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

      {error && <p className="sidebar-error">{error}</p>}
      {!error && targets.length === 0 && <p className="sidebar-empty">No targets yet</p>}

      <ul className="target-list">
        {targets.map((target) => (
          <li key={target.id} className="target-row">
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
            <button
              type="button"
              className="target-delete"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteTarget(target)
              }}
              aria-label={`Delete ${target.name}`}
              title={`Delete ${target.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="add-target-form">
        <h3 className="sidebar-subtitle">Add Target</h3>
        <button type="button" onClick={onOpenAddTarget}>
          Add Target
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
