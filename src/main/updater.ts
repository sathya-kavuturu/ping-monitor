import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { UpdateStatusEvent } from '../shared/types'
import { IpcChannels } from '../shared/ipc-channels'

// Packaged builds only: in dev there's no packaged app.asar / app-update.yml
// for electron-updater to read, and it would just error out on every check.
const canCheckForUpdates = (): boolean => app.isPackaged

// electron-updater ships its own info/warn/error/debug logger hook but logs
// nowhere by default - a failed download or a stuck differential-update
// patch (NsisUpdater's own cache under `<app>-updater/`) previously left no
// trail at all beyond the four coarse states already forwarded to the
// renderer (checking/available/downloading/error). This gives every run a
// permanent, appendable record of exactly what electron-updater itself saw
// (HTTP errors, checksum mismatches, which download strategy it picked) -
// plain fs, no new dependency, since electron-updater only needs an object
// shaped like a logger, not any particular library.
function updateLogPath(): string {
  return path.join(app.getPath('userData'), 'update.log')
}

function fileLogger(level: string, args: unknown[]): void {
  const message = args
    .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
    .join(' ')
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
  try {
    fs.appendFileSync(updateLogPath(), line)
  } catch {
    // Logging is best-effort - never let a disk error break the update flow.
  }
}

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

  // Downloading is only ever user-initiated (the renderer's Update/Cancel
  // dialog), never silent - so a slow/metered connection is never spent
  // without asking first.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  // The default differential (block-map delta patch) download fetches the
  // new installer as many small HTTP byte-range requests against the old
  // one already on disk - update.log showed this stalling for minutes,
  // crawling forward a few hundred KB at a time with no error ever raised,
  // apparently from how poorly this network path tolerates that many small
  // chunked requests through GitHub's release-asset CDN redirect. A single
  // plain full-file download of the ~100MB installer has none of that
  // per-chunk fragility - more bytes over the wire, but it actually finishes.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.logger = {
    info: (...args: unknown[]) => fileLogger('info', args),
    warn: (...args: unknown[]) => fileLogger('warn', args),
    error: (...args: unknown[]) => fileLogger('error', args),
    debug: (...args: unknown[]) => fileLogger('debug', args)
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    send({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    send({ state: 'downloaded', version: info.version })
    // The dialog's "Update" button is the only thing that ever starts a
    // download, so reaching here always means the user already asked for
    // this - no second "restart now?" prompt, just do it.
    autoUpdater.quitAndInstall()
  })
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

/** Starts downloading the update the last `update-available` event described. */
export function downloadUpdate(): void {
  void autoUpdater.downloadUpdate()
}
