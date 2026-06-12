import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('officer', {
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  setSecret: (key: string, value: string) => ipcRenderer.invoke('secrets:set', key, value),
  hasSecret: (key: string) => ipcRenderer.invoke('secrets:has', key),
  validateGw2Key: () => ipcRenderer.invoke('gw2:validate-key'),
  axitoolsStatus: () => ipcRenderer.invoke('axitools:status'),
  sendMessage: (text: string) => ipcRenderer.invoke('agent:send', text),
  resetSession: () => ipcRenderer.invoke('agent:reset'),
  cancelTurn: () => ipcRenderer.invoke('agent:cancel'),
  onAgentEvent: (cb: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown): void => cb(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onConfirmRequest: (cb: (req: unknown) => void) => {
    const listener = (_e: unknown, req: unknown): void => cb(req)
    ipcRenderer.on('agent:confirm-request', listener)
    return () => ipcRenderer.removeListener('agent:confirm-request', listener)
  },
  respondConfirm: (id: string, allowed: boolean) =>
    ipcRenderer.send('agent:confirm-response', { id, allowed }),
  windowControl: (action: 'minimize' | 'maximize-toggle' | 'close') =>
    ipcRenderer.send('window:control', action),
  listKeys: (service: string) => ipcRenderer.invoke('keys:list', service),
  addKey: (service: string, label: string, key: string) =>
    ipcRenderer.invoke('keys:add', service, label, key),
  removeKey: (service: string, label: string) => ipcRenderer.invoke('keys:remove', service, label),
  setActiveKey: (service: string, label: string) =>
    ipcRenderer.invoke('keys:set-active', service, label),
  axitools: (method: string, ...args: unknown[]) =>
    ipcRenderer.invoke('axitools:call', method, ...args),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown): void => cb(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  }
})
