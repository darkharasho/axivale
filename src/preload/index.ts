import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('officer', {
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  setSecret: (key: string, value: string) => ipcRenderer.invoke('secrets:set', key, value),
  hasSecret: (key: string) => ipcRenderer.invoke('secrets:has', key),
  validateGw2Key: () => ipcRenderer.invoke('gw2:validate-key'),
  axitoolsStatus: () => ipcRenderer.invoke('axitools:status'),
  axiforgeStatus: () => ipcRenderer.invoke('axiforge:status'),
  axiforgeLaunch: () => ipcRenderer.invoke('axiforge:launch'),
  axibridgeReposList: () => ipcRenderer.invoke('axibridge:repos-list'),
  axibridgeReposAdd: (input: string) => ipcRenderer.invoke('axibridge:repos-add', input),
  axibridgeReposRemove: (owner: string, repo: string) =>
    ipcRenderer.invoke('axibridge:repos-remove', owner, repo),
  axibridgeStatus: () => ipcRenderer.invoke('axibridge:status'),
  githubAuthBegin: () => ipcRenderer.invoke('github:auth-begin'),
  githubAuthComplete: (deviceCode: string, interval: number, expiresIn: number) =>
    ipcRenderer.invoke('github:auth-complete', deviceCode, interval, expiresIn),
  githubDiscoverRepos: () => ipcRenderer.invoke('github:discover-repos'),
  shareConversation: (conversationId: string) =>
    ipcRenderer.invoke('share:createConversation', conversationId),
  shareResponse: (conversationId: string, turnId: number) =>
    ipcRenderer.invoke('share:createResponse', conversationId, turnId),
  shareList: () => ipcRenderer.invoke('share:list'),
  shareDelete: (id: string) => ipcRenderer.invoke('share:delete', id),
  shareStatus: () => ipcRenderer.invoke('share:status'),
  forgeCatalogUpgrades: () => ipcRenderer.invoke('axiforge:catalog-upgrades'),
  sendMessage: (conversationId: string, text: string, forcedSkillId?: string) =>
    ipcRenderer.invoke('agent:send', conversationId, text, forcedSkillId),
  metaList: () => ipcRenderer.invoke('meta:list'),
  metaAddMode: (seed: { mode: string; sources: { label: string; url: string }[]; notes?: string }) =>
    ipcRenderer.invoke('meta:add-mode', seed),
  metaUpdateMode: (
    id: string,
    patch: Partial<{ mode: string; sources: { label: string; url: string }[]; notes: string }>
  ) => ipcRenderer.invoke('meta:update-mode', id, patch),
  metaRemoveMode: (id: string) => ipcRenderer.invoke('meta:remove-mode', id),
  metaUpdatePlaybook: (id: string, patch: { principles?: string; overrides?: string; blessed?: boolean }) =>
    ipcRenderer.invoke('meta:update-playbook', id, patch),
  metaDeriveComp: (id: string) => ipcRenderer.invoke('meta:derive-comp', id),
  metaForceRefresh: () => ipcRenderer.invoke('meta:force-refresh'),
  metaIndexStats: () => ipcRenderer.invoke('meta:index-stats'),
  metaIndexSample: (opts: { mode?: string; limit: number }) => ipcRenderer.invoke('meta:index-sample', opts),
  metaIndexSearch: (query: string, mode?: string) => ipcRenderer.invoke('meta:index-search', query, mode),
  wikiIndexStats: () => ipcRenderer.invoke('wiki:index-stats'),
  wikiIndexSample: (opts: { mode?: string; limit: number }) => ipcRenderer.invoke('wiki:index-sample', opts),
  wikiIndexSearch: (query: string, mode?: string) => ipcRenderer.invoke('wiki:index-search', query, mode),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsCreate: (seed: { name: string; whenToUse: string; instructions: string }) =>
    ipcRenderer.invoke('skills:create', seed),
  skillsUpdate: (
    id: string,
    patch: Partial<{ name: string; whenToUse: string; instructions: string; enabled: boolean }>
  ) => ipcRenderer.invoke('skills:update', id, patch),
  skillsDelete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  rosterAnnotationsList: () => ipcRenderer.invoke('roster:annotations:list'),
  rosterAnnotationUpsert: (
    memberId: string,
    patch: Partial<{ nickname: string; aliases: string[]; notes: string; tags: string[] }>
  ) => ipcRenderer.invoke('roster:annotations:upsert', memberId, patch),
  rosterAnnotationDelete: (memberId: string) =>
    ipcRenderer.invoke('roster:annotations:delete', memberId),
  resetSession: (conversationId: string) => ipcRenderer.invoke('agent:reset', conversationId),
  cancelTurn: (conversationId: string) => ipcRenderer.invoke('agent:cancel', conversationId),
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  getConversation: (id: string) => ipcRenderer.invoke('conversations:get', id),
  createConversation: (seed?: unknown) => ipcRenderer.invoke('conversations:create', seed),
  saveTurns: (id: string, turns: unknown) =>
    ipcRenderer.invoke('conversations:save-turns', id, turns),
  renameConversation: (id: string, title: string | null) =>
    ipcRenderer.invoke('conversations:rename', id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  setActiveConversation: (id: string) => ipcRenderer.invoke('conversations:set-active', id),
  markConversationSeen: (id: string, count: number) =>
    ipcRenderer.invoke('conversations:mark-seen', id, count),
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
  localStatus: () => ipcRenderer.invoke('local:status'),
  providerStatus: () => ipcRenderer.invoke('provider:status'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown): void => cb(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  },
  onAxibridgeProgress: (cb: (message: unknown) => void) => {
    const listener = (_e: unknown, message: unknown): void => cb(message)
    ipcRenderer.on('axibridge:progress', listener)
    return () => ipcRenderer.removeListener('axibridge:progress', listener)
  },
  onMetaProgress: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on('meta:progress', handler)
    return () => ipcRenderer.removeListener('meta:progress', handler)
  },
  onLearnProgress: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on('learn:progress', handler)
    return () => ipcRenderer.removeListener('learn:progress', handler)
  },
  ollamaDetectHardware: () => ipcRenderer.invoke('ollama:detect-hardware'),
  ollamaGetStatus: () => ipcRenderer.invoke('ollama:get-status'),
  ollamaInstall: () => ipcRenderer.invoke('ollama:install'),
  ollamaPullModel: (model: string) => ipcRenderer.invoke('ollama:pull-model', model),
  ollamaUninstall: () => ipcRenderer.invoke('ollama:uninstall'),
  onOllamaProgress: (cb: (p: { kind: string; stage?: string; status?: string; percent?: number }) => void) => {
    const handler = (
      _e: unknown,
      payload: { kind: string; stage?: string; status?: string; percent?: number }
    ): void => cb(payload)
    ipcRenderer.on('ollama:progress', handler)
    return () => ipcRenderer.removeListener('ollama:progress', handler)
  }
})
