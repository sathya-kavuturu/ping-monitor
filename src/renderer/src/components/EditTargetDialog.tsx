import { useEffect, useState, type FormEvent } from 'react'
import type { TargetWithStatus } from '../App'
import type { UpdateTargetInput } from '../../../shared/types'
import Modal from './Modal'

interface EditTargetDialogProps {
  target: TargetWithStatus
  onUpdateTarget: (input: UpdateTargetInput) => void
  isUpdating: boolean
  error: string | null
  onClose: () => void
}

const RESOLVE_DEBOUNCE_MS = 400

/** Opened from the sidebar's right-click context menu - closed by `App` once the update succeeds. */
function EditTargetDialog({
  target,
  onUpdateTarget,
  isUpdating,
  error,
  onClose
}: EditTargetDialogProps): React.JSX.Element {
  const [name, setName] = useState(target.name)
  const [host, setHost] = useState(target.host)
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
    onUpdateTarget({ id: target.id, name: name.trim(), host: host.trim() })
  }

  const showResolvedIp = resolvedIp !== null && resolvedIp !== host.trim()

  return (
    <Modal title="Edit Target" onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isUpdating}
          autoFocus
        />
        <input
          type="text"
          placeholder="Host / IP"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          disabled={isUpdating}
        />
        {showResolvedIp && <p className="resolved-ip-hint">Resolves to {resolvedIp}</p>}
        {error && <p className="sidebar-error">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="update-dialog-btn"
            onClick={onClose}
            disabled={isUpdating}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="update-dialog-btn update-dialog-btn--primary"
            disabled={isUpdating || !name.trim() || !host.trim()}
          >
            {isUpdating ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default EditTargetDialog
