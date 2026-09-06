import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { is } from './utils'
import { IpcChannels } from '../shared/ipc-channels'
import type {
  CreateAlertRuleInput,
  CreateTargetInput,
  HopHistoryQuery,
  NetworkUpdate,
  PingHistoryQuery
} from '../shared/types'
import { NetworkEngine } from './network/engine'
import { AlertWatchdog } from './alerting/watchdog'
import { notifyAlertEvent } from './alerting/notifications'
import { createTray, destroyTray } from './tray'
import { initAutoUpdater, checkForUpdates, installUpdate } from './updater'
import { initDatabase, closeDatabase } from './db/client'
import { createTarget, listTargets } from './db/targets'
import { savePingRollup, getPingHistory, type RawPingSample } from './db/ping-history'
import { saveHopHistory, getHopHistory } from './db/hop-history'
import {
  createAlertRule,
  listAlertRules,
  setAlertRuleEnabled,
  deleteAlertRule
} from './db/alert-rules'
import type { Target as DbTarget } from '../generated/prisma/client'

let mainWindow: BrowserWindow | null = null
// Only true once a real quit is underway (see 'before-quit') - lets the
// window's 'close' handler tell "user clicked X" apart from "actually quitting".
let isQuitting = false

// Targets currently known to the network engine/watchdog. Refreshed from
// the DB on startup and after every `targets:create` call.
let currentTargets: DbTarget[] = []

// Raw per-ping samples buffered since the last 1-minute rollup flush.
const pingBuffers = new Map<string, RawPingSample[]>()
let rollupFlushTimer: ReturnType<typeof setInterval> | null = null
const ROLLUP_FLUSH_INTERVAL_MS = 60_000

/**
 * The actual monitoring service: one ping loop (every 2s) + one traceroute
 * loop (every 30s) per target, real OS probes via `ping`/`tracert`/
 * `traceroute`. Runs independently of any window - hiding it to the tray,
 * or closing it on macOS, doesn't stop monitoring, only quitting the app does.
 */
const engine = new NetworkEngine({
  onSample: (update: NetworkUpdate) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.NetworkUpdate, update)
    }

    const buffer = pingBuffers.get(update.targetId) ?? []
    buffer.push({ latencyMs: update.latencyMs, throughputMbps: null })
    pingBuffers.set(update.targetId, buffer)

    watchdog.evaluate(update)
  },
  onTraceroute: (targetId, hops) => {
    if (hops.length === 0) return
    const traceId = `trace-${targetId}-${Date.now()}`
    saveHopHistory({ targetId, traceId, hops }).catch((error: unknown) => {
      console.error(`Failed to save traceroute for target ${targetId}:`, error)
    })
  }
})

/**
 * Evaluates every live sample against the configured `AlertRule`s and fires
 * a native OS notification on breach/recovery - works identically whether
 * the window is open, hidden in the tray, or on another virtual desktop.
 */
const watchdog = new AlertWatchdog({
  onAlert: (event) => {
    notifyAlertEvent(event, () => showMainWindow())
  }
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // --- Security-critical settings ---
      contextIsolation: true, // renderer world is isolated from preload/main world
      nodeIntegration: false, // no Node.js APIs in the renderer
      sandbox: true, // renderer process runs in the OS-level sandbox
      webSecurity: true, // enforce same-origin policy / block mixed content
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open all target="_blank" / window.open links in the OS browser instead
  // of a new, less-controlled BrowserWindow.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Refuse to navigate the window anywhere other than the app's own
  // dev-server / packaged renderer origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = is.dev && process.env['ELECTRON_RENDERER_URL']
    if (!allowed || url !== process.env['ELECTRON_RENDERER_URL']) {
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Minimize to tray instead of quitting: closing the window just hides it.
  // The engine/watchdog keep running - only `before-quit` really tears down.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    showMainWindow()
  }
}

async function refreshCurrentTargets(): Promise<void> {
  currentTargets = await listTargets()
  engine.sync(currentTargets.map((target) => ({ id: target.id, host: target.host })))
  watchdog.syncTargets(currentTargets.map((target) => ({ id: target.id, name: target.name })))
}

async function refreshAlertRules(): Promise<void> {
  watchdog.syncRules(await listAlertRules())
}

async function flushPingRollups(): Promise<void> {
  const bucketStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  const entries = Array.from(pingBuffers.entries())
  pingBuffers.clear()

  for (const [targetId, samples] of entries) {
    if (samples.length === 0) continue
    try {
      await savePingRollup({ targetId, bucketStart, samples })
    } catch (error) {
      console.error(`Failed to save ping rollup for target ${targetId}:`, error)
    }
  }
}

/**
 * Rejects any IPC call that didn't originate from this app's own main
 * window, so a compromised/loaded-in third-party frame can't invoke handlers.
 */
function isTrustedSender(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false
  const senderUrl = new URL(frame.url)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    return senderUrl.origin === devUrl.origin
  }
  return senderUrl.protocol === 'file:'
}

function assertTrustedSender(frame: Electron.WebFrameMain | null): void {
  if (!isTrustedSender(frame)) {
    throw new Error('Untrusted IPC sender')
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.TargetsList, async (event) => {
    assertTrustedSender(event.senderFrame)
    return listTargets()
  })

  ipcMain.handle(IpcChannels.TargetsCreate, async (event, input: CreateTargetInput) => {
    assertTrustedSender(event.senderFrame)
    const target = await createTarget(input)
    await refreshCurrentTargets()
    return target
  })

  ipcMain.handle(IpcChannels.PingHistoryList, async (event, query: PingHistoryQuery) => {
    assertTrustedSender(event.senderFrame)
    return getPingHistory(query)
  })

  ipcMain.handle(IpcChannels.HopHistoryList, async (event, query: HopHistoryQuery) => {
    assertTrustedSender(event.senderFrame)
    return getHopHistory(query)
  })

  ipcMain.handle(IpcChannels.AlertRulesList, async (event, targetId: string) => {
    assertTrustedSender(event.senderFrame)
    return listAlertRules(targetId)
  })

  ipcMain.handle(IpcChannels.AlertRulesCreate, async (event, input: CreateAlertRuleInput) => {
    assertTrustedSender(event.senderFrame)
    const rule = await createAlertRule(input)
    await refreshAlertRules()
    return rule
  })

  ipcMain.handle(IpcChannels.AlertRulesSetEnabled, async (event, id: string, enabled: boolean) => {
    assertTrustedSender(event.senderFrame)
    const rule = await setAlertRuleEnabled(id, enabled)
    await refreshAlertRules()
    return rule
  })

  ipcMain.handle(IpcChannels.AlertRulesDelete, async (event, id: string) => {
    assertTrustedSender(event.senderFrame)
    await deleteAlertRule(id)
    await refreshAlertRules()
  })

  ipcMain.on(IpcChannels.UpdateCheck, (event) => {
    assertTrustedSender(event.senderFrame)
    checkForUpdates()
  })

  ipcMain.on(IpcChannels.UpdateInstall, (event) => {
    assertTrustedSender(event.senderFrame)
    installUpdate()
  })
}

app.whenReady().then(async () => {
  // Improves how Windows groups/attributes this app's notifications.
  app.setAppUserModelId(app.name)

  // Lock down Content-Security-Policy for every response the app serves,
  // in addition to whatever is set in the renderer's index.html.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
        ]
      }
    })
  })

  initDatabase()
  await refreshCurrentTargets()
  await refreshAlertRules()
  rollupFlushTimer = setInterval(() => void flushPingRollups(), ROLLUP_FLUSH_INTERVAL_MS)

  registerIpcHandlers()
  createWindow()
  createTray({
    onToggleWindow: toggleMainWindow,
    onShowWindow: showMainWindow,
    onQuit: () => app.quit()
  })
  initAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    showMainWindow()
  })
})

// Intentionally does NOT quit: the window's 'close' handler hides rather
// than destroys it, so this normally never fires from a user closing the
// window. The tray (not the window) is what keeps the app - and the
// engine/watchdog polling in the background - alive; only its "Quit" item
// (or an OS shutdown) really exits.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  isQuitting = true
  engine.stopAll()
  if (rollupFlushTimer) clearInterval(rollupFlushTimer)
  destroyTray()
  void closeDatabase()
})

// Defense in depth: block any renderer from spawning further webContents
// (e.g. <webview> tags) that weren't explicitly configured for this app.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})
