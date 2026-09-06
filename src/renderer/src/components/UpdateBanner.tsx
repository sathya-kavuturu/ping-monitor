import { useEffect, useState } from 'react'
import type { UpdateStatusEvent } from '../../../shared/types'

/**
 * Sits at the top of the app shell and stays invisible until main reports
 * something worth surfacing. Only the "available" (still downloading) and
 * "downloaded" (ready to restart) states show a button - checking/
 * not-available/error states are silent so this never nags the user.
 */
function UpdateBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatusEvent | null>(null)

  useEffect(() => {
    return window.api.onUpdateStatus(setStatus)
  }, [])

  if (!status || status.state === 'checking' || status.state === 'not-available') {
    return null
  }

  if (status.state === 'error') {
    return null
  }

  const isReady = status.state === 'downloaded'

  return (
    <div className="update-banner">
      <span className="update-banner-text">
        {isReady
          ? `Update to v${status.version} downloaded and ready to install.`
          : status.state === 'downloading'
            ? `Downloading update... ${status.percent}%`
            : `A new version (v${status.version}) is available.`}
      </span>
      {isReady && (
        <button className="update-banner-btn" onClick={() => window.api.installUpdate()}>
          Restart to Update
        </button>
      )}
    </div>
  )
}

export default UpdateBanner
