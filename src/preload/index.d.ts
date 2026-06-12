export interface OfficerApi {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  setSecret(key: string, value: string): Promise<void>
  hasSecret(key: string): Promise<boolean>
  validateGw2Key(): Promise<{ ok: boolean; info?: unknown; error?: string }>
  axitoolsStatus(): Promise<{
    ok: boolean
    guilds?: Array<{ id: string; name: string }>
    error?: string
  }>
  sendMessage(text: string): Promise<void>
  resetSession(): Promise<void>
  cancelTurn(): Promise<void>
  onAgentEvent(cb: (event: unknown) => void): () => void
  onConfirmRequest(cb: (req: unknown) => void): () => void
  respondConfirm(id: string, allowed: boolean): void
  windowControl(action: 'minimize' | 'maximize-toggle' | 'close'): void
  listKeys(service: 'gw2' | 'axivale' | 'gemini' | 'openai'): Promise<Array<{ label: string; active: boolean }>>
  addKey(service: 'gw2' | 'axivale' | 'gemini' | 'openai', label: string, key: string): Promise<void>
  removeKey(service: 'gw2' | 'axivale' | 'gemini' | 'openai', label: string): Promise<void>
  setActiveKey(service: 'gw2' | 'axivale' | 'gemini' | 'openai', label: string): Promise<void>
  /** Whitelisted AxitoolsClient call on the connected guild (see PANEL_METHODS in main). */
  axitools(method: string, ...args: unknown[]): Promise<unknown>
  localStatus(): Promise<{ ok: boolean; models?: string[]; error?: string }>
  providerStatus(): Promise<{
    provider: 'claude' | 'gemini' | 'openai' | 'local'
    ready: boolean
    note: string | null
  }>
  appVersion(): Promise<string>
  checkUpdates(): Promise<unknown>
  installUpdate(): Promise<void>
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

declare global {
  interface Window {
    officer: OfficerApi
  }
}
