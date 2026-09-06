import Modal from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  isConfirming?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** A `Modal` specialized for "are you sure?" prompts - used for target deletion. */
function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  isConfirming = false,
  error,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="modal-message">{message}</p>
      {error && <p className="sidebar-error">{error}</p>}
      <div className="modal-actions">
        <button
          type="button"
          className="update-dialog-btn"
          onClick={onCancel}
          disabled={isConfirming}
        >
          Cancel
        </button>
        <button
          type="button"
          className="update-dialog-btn update-dialog-btn--danger"
          onClick={onConfirm}
          disabled={isConfirming}
        >
          {isConfirming ? 'Deleting…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export default ConfirmDialog
