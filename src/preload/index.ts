import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipc-channels'
import type { ExposedApi, NetworkUpdate, UpdateStatusEvent } from '../shared/types'

/**
 * The ONLY surface the renderer ever sees. `ipcRenderer` itself is never
 * exposed, so the renderer cannot invoke/send on arbitrary channels or
 * register listeners it isn't handed back a cleanup function for.
 */
const api: ExposedApi = {
  getTargets: () => ipcRenderer.invoke(IpcChannels.TargetsList),

  createTarget: (input) => ipcRenderer.invoke(IpcChannels.TargetsCreate, input),

  updateTarget: (input) => ipcRenderer.invoke(IpcChannels.TargetsUpdate, input),

  deleteTarget: (id) => ipcRenderer.invoke(IpcChannels.TargetsDelete, id),

  resolveHostname: (host) => ipcRenderer.invoke(IpcChannels.ResolveHostname, host),

  getPingHistory: (query) => ipcRenderer.invoke(IpcChannels.PingHistoryList, query),

  getHopHistory: (query) => ipcRenderer.invoke(IpcChannels.HopHistoryList, query),

  getAlertRules: (targetId) => ipcRenderer.invoke(IpcChannels.AlertRulesList, targetId),

  createAlertRule: (input) => ipcRenderer.invoke(IpcChannels.AlertRulesCreate, input),

  setAlertRuleEnabled: (id, enabled) =>
    ipcRenderer.invoke(IpcChannels.AlertRulesSetEnabled, id, enabled),

  deleteAlertRule: (id) => ipcRenderer.invoke(IpcChannels.AlertRulesDelete, id),

  onNetworkUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, update: NetworkUpdate): void => {
      callback(update)
    }
    ipcRenderer.on(IpcChannels.NetworkUpdate, listener)
    // Caller-owned unsubscribe so a component can clean up on unmount and
    // never accumulate duplicate listeners across renders.
    return () => {
      ipcRenderer.removeListener(IpcChannels.NetworkUpdate, listener)
    }
  },

  getSettings: () => ipcRenderer.invoke(IpcChannels.SettingsGet),

  setPingIntervalMs: (ms) => ipcRenderer.invoke(IpcChannels.SettingsSetPingInterval, ms),

  checkForUpdates: () => ipcRenderer.send(IpcChannels.UpdateCheck),

  downloadUpdate: () => ipcRenderer.send(IpcChannels.UpdateDownload),

  onUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatusEvent): void => {
      callback(status)
    }
    ipcRenderer.on(IpcChannels.UpdateStatus, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.UpdateStatus, listener)
    }
  }
}

// contextIsolation is enabled (see main/index.ts), so `window` in the
// renderer is a different object than the one in this script - the only
// way across is contextBridge, which deep-clones values via structured
// clone and refuses to leak Node/Electron internals.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback path only ever hit if contextIsolation was mistakenly disabled;
  // kept so the app fails loudly in dev rather than silently losing the API.
  // @ts-expect-error - deliberate escape hatch, not part of the typed contract
  window.api = api
}
