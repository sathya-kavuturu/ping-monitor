import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'

export interface TrayCallbacks {
  /** Left-click on the icon: show the window if hidden, hide it if visible. */
  onToggleWindow: () => void
  /** "Show Dashboard" menu item: always bring the window up. */
  onShowWindow: () => void
  onQuit: () => void
}

let tray: Tray | null = null

function resolveIconPath(): string {
  // Shipped alongside the app code (see electron-builder.yml `files`), so
  // this resolves the same way in dev (project root) and packaged
  // (app.asar root) - same trick used for prisma/migrations.
  return join(app.getAppPath(), 'resources', 'tray-icon.png')
}

/**
 * Lets the app keep running (and the network engine + watchdog keep
 * polling/alerting) after the window is closed. Purely presentational -
 * show/hide/quit decisions live in `src/main/index.ts`.
 */
export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(resolveIconPath())
  tray = new Tray(icon)
  tray.setToolTip('Ping Monitor')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Dashboard', click: () => callbacks.onShowWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => callbacks.onQuit() }
    ])
  )

  tray.on('click', () => callbacks.onToggleWindow())

  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
