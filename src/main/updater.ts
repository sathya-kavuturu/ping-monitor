import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateStatusEvent } from '../shared/types'
import { IpcChannels } from '../shared/ipc-channels'

// Packaged builds only: in dev there's no packaged app.asar / app-update.yml
// for electron-updater to read, and it would just error out on every check.
const canCheckForUpdates = (): boolean => app.isPackaged

let getWindow: (() => BrowserWindow | null) | null = null

function send(event: UpdateStatusEvent): void {
  const win = getWindow?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.UpdateStatus, event)
  }
}

/**
 * Wires electron-updater's events to the renderer over IPC and starts an
 * initial check. Reads publish config (owner/repo) baked into
 * `app-update.yml` at build time from `electron-builder.yml`'s `publish`
 * block - nothing to configure here at runtime.
 */
export function initAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    send({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => send({ state: 'error', message: error.message }))

  if (canCheckForUpdates()) {
    void autoUpdater.checkForUpdates()
  }
}

export function checkForUpdates(): void {
  if (canCheckForUpdates()) {
    void autoUpdater.checkForUpdates()
  } else {
    send({ state: 'error', message: 'Updates are only available in a packaged build.' })
  }
}

/** Quits and restarts the app into the already-downloaded update. */
export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
