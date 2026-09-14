import type { TargetWithStatus } from '../App'
import Modal from './Modal'

interface DisablePingingDialogProps {
  targets: TargetWithStatus[]
  onTogglePinging: (target: TargetWithStatus) => void
  onClose: () => void
}

/**
 * Opened by the sidebar's "Disable Pinging" button - lets the user pick
 * which targets should keep being actively pinged/traced. Unchecking a
 * target stops its engine timer immediately (see `handleToggleTargetPinging`
 * in `App`), the same optimistic-toggle pattern as "Show in Overview", so
 * there's no separate save step here.
 */
function DisablePingingDialog({
  targets,
  onTogglePinging,
  onClose
}: DisablePingingDialogProps): React.JSX.Element {
  return (
    <Modal title="Disable Pinging" onClose={onClose}>
      <div className="modal-form">
        <p className="modal-hint">
          Uncheck a target to stop pinging and tracing it. It stays in the sidebar, but produces no
          new data and is hidden from Overview until re-checked here.
        </p>

        {targets.length === 0 ? (
          <p className="sidebar-empty">No targets yet</p>
        ) : (
          <div className="target-checkbox-list target-checkbox-list--column">
            {targets.map((target) => (
              <label key={target.id} className="target-checkbox">
                <input
                  type="checkbox"
                  checked={target.pingingEnabled}
                  onChange={() => onTogglePinging(target)}
                />
                <span>
                  {target.name} ({target.host})
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="update-dialog-btn update-dialog-btn--primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default DisablePingingDialog
