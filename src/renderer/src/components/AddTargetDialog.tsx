import { useState, type FormEvent } from 'react'
import type { CreateTargetInput } from '../../../shared/types'
import Modal from './Modal'

interface AddTargetDialogProps {
  onCreateTarget: (input: CreateTargetInput) => void
  isCreating: boolean
  error: string | null
  onClose: () => void
}

/** Opened by the sidebar's "Add Target" button - closed by `App` once creation succeeds. */
function AddTargetDialog({
  onCreateTarget,
  isCreating,
  error,
  onClose
}: AddTargetDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!name.trim() || !host.trim()) return
    onCreateTarget({ name: name.trim(), host: host.trim() })
  }

  return (
    <Modal title="Add Target" onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isCreating}
          autoFocus
        />
        <input
          type="text"
          placeholder="Host / IP"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          disabled={isCreating}
        />
        {error && <p className="sidebar-error">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="update-dialog-btn"
            onClick={onClose}
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="update-dialog-btn update-dialog-btn--primary"
            disabled={isCreating || !name.trim() || !host.trim()}
          >
            {isCreating ? 'Adding…' : 'Add Target'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default AddTargetDialog
