import { useEffect, useRef, useState } from 'react'
import type { UpdateStatusEvent } from '../../../shared/types'

/**
 * Small dialog pinned to the bottom-left corner - stays invisible until an
 * update is actually available, then asks before doing anything (downloads
 * are never silent/automatic). Clicking Update both downloads AND installs:
 * once the download finishes, main quits and restarts on its own - there's
 * no second "restart now?" step because the user already agreed to it here.
 */
function UpdateDialog(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatusEvent | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  // Distinguishes "check failed in the background" (stay silent) from "the
  // download the user asked for failed" (say so) - both arrive as the same
  // IPC event.
  const downloadRequested = useRef(false)

  useEffect(() => {
    return window.api.onUpdateStatus(setStatus)
  }, [])

  if (!status) return null

  if (status.state === 'available' && status.version === dismissedVersion) {
    return null
  }

  const handleUpdate = (): void => {
    downloadRequested.current = true
    window.api.downloadUpdate()
  }

  const handleCancel = (): void => {
    if (status.state === 'available') setDismissedVersion(status.version)
  }

  if (status.state === 'available') {
    return (
      <div className="update-dialog">
        <div className="update-dialog-title">Update available</div>
        <div className="update-dialog-text">Version {status.version} is ready to download.</div>
        <div className="update-dialog-actions">
          <button className="update-dialog-btn" onClick={handleCancel}>
            Cancel
          </button>
          <button className="update-dialog-btn update-dialog-btn--primary" onClick={handleUpdate}>
            Update
          </button>
        </div>
      </div>
    )
  }

  if (status.state === 'downloading') {
    return (
      <div className="update-dialog">
        <div className="update-dialog-title">Downloading update…</div>
        <div className="update-progress-track">
          <div className="update-progress-fill" style={{ width: `${status.percent}%` }} />
        </div>
        <div className="update-dialog-text">{status.percent}%</div>
      </div>
    )
  }

  if (status.state === 'downloaded') {
    return (
      <div className="update-dialog">
        <div className="update-dialog-title">Restarting to install…</div>
      </div>
    )
  }

  if (status.state === 'error' && downloadRequested.current) {
    return (
      <div className="update-dialog">
        <div className="update-dialog-title">Update failed</div>
        <div className="update-dialog-text">{status.message}</div>
        <div className="update-dialog-actions">
          <button
            className="update-dialog-btn"
            onClick={() => {
              downloadRequested.current = false
              setStatus(null)
            }}
          >
            Dismiss
          </button>
          <button className="update-dialog-btn update-dialog-btn--primary" onClick={handleUpdate}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default UpdateDialog
