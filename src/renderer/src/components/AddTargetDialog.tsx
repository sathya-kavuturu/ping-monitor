import { useEffect, useState, type FormEvent } from 'react'
import type { CreateTargetInput } from '../../../shared/types'
import Modal from './Modal'

interface AddTargetDialogProps {
  onCreateTarget: (input: CreateTargetInput) => void
  isCreating: boolean
  error: string | null
  onClose: () => void
}

const RESOLVE_DEBOUNCE_MS = 400

/** Opened by the sidebar's "Add Target" button - closed by `App` once creation succeeds. */
function AddTargetDialog({
  onCreateTarget,
  isCreating,
  error,
  onClose
}: AddTargetDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [resolvedIp, setResolvedIp] = useState<string | null>(null)

  // Debounced forward-DNS lookup so a DNS name shows the IP it'll actually
  // ping - `resolveHostname` handles an IP literal by returning it
  // unchanged, so a matching result is deliberately hidden below rather than
  // shown as a redundant "resolves to itself".
  useEffect(() => {
    const trimmed = host.trim()
    if (!trimmed) {
      setResolvedIp(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      window.api
        .resolveHostname(trimmed)
        .then((ip) => {
          if (!cancelled) setResolvedIp(ip)
        })
        .catch(() => {
          if (!cancelled) setResolvedIp(null)
        })
    }, RESOLVE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [host])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!name.trim() || !host.trim()) return
    onCreateTarget({ name: name.trim(), host: host.trim() })
  }

  const showResolvedIp = resolvedIp !== null && resolvedIp !== host.trim()

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
        {showResolvedIp && <p className="resolved-ip-hint">Resolves to {resolvedIp}</p>}
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
