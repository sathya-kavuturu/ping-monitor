/**
 * Single source of truth for IPC channel names, shared by main, preload and
 * renderer so the string literals only ever live in one place.
 */
export const IpcChannels = {
  TargetsList: 'targets:list',
  TargetsCreate: 'targets:create',
  TargetsDelete: 'targets:delete',
  PingHistoryList: 'ping-history:list',
  HopHistoryList: 'hop-history:list',
  AlertRulesList: 'alert-rules:list',
  AlertRulesCreate: 'alert-rules:create',
  AlertRulesSetEnabled: 'alert-rules:set-enabled',
  AlertRulesDelete: 'alert-rules:delete',
  NetworkUpdate: 'network:update',
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateStatus: 'update:status'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
