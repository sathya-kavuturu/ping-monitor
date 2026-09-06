import { useState, type FormEvent } from 'react'
import type { CreateTargetInput } from '../../../shared/types'
import type { TargetWithStatus } from '../App'

interface SidebarProps {
  targets: TargetWithStatus[]
  selectedTargetId: string | null
  onSelectTarget: (id: string) => void
  onCreateTarget: (input: CreateTargetInput) => void
  isCreating: boolean
  error: string | null
  createError: string | null
}

function Sidebar({
  targets,
  selectedTargetId,
  onSelectTarget,
  onCreateTarget,
  isCreating,
  error,
  createError
}: SidebarProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!name.trim() || !host.trim()) return
    onCreateTarget({ name: name.trim(), host: host.trim() })
    setName('')
    setHost('')
  }

  return (
    <aside className="sidebar">
      <h2 className="sidebar-title">Monitored Targets</h2>

      {error && <p className="sidebar-error">{error}</p>}
      {!error && targets.length === 0 && <p className="sidebar-empty">No targets yet</p>}

      <ul className="target-list">
        {targets.map((target) => (
          <li key={target.id}>
            <button
              type="button"
              className={`target-item ${target.id === selectedTargetId ? 'is-selected' : ''}`}
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

      <form className="add-target-form" onSubmit={handleSubmit}>
        <h3 className="sidebar-subtitle">Add Target</h3>
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isCreating}
        />
        <input
          type="text"
          placeholder="Host / IP"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          disabled={isCreating}
        />
        <button type="submit" disabled={isCreating || !name.trim() || !host.trim()}>
          {isCreating ? 'Adding…' : 'Add Target'}
        </button>
        {createError && <p className="sidebar-error">{createError}</p>}
      </form>
    </aside>
  )
}

export default Sidebar
