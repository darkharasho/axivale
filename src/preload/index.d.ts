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
  axiforgeStatus(): Promise<
    { state: 'connected'; version: string } | { state: 'file-only' } | { state: 'offline' }
  >
  /** Cached AxiForge upgrade catalog for inline cards; null when never fetched. */
  forgeCatalogUpgrades(): Promise<{
    runes: Array<{ id: number; name: string; icon?: string; bonuses?: string[] }>
    relics: Array<{ name: string; icon?: string }>
  } | null>
  /** Linked AxiBridge report repos. */
  axibridgeReposList(): Promise<Array<{ owner: string; repo: string }>>
  /** Validate + add a repo (owner/repo or GitHub Pages URL); returns the updated list. */
  axibridgeReposAdd(
    input: string
  ): Promise<
    { ok: true; repos: Array<{ owner: string; repo: string }> } | { ok: false; error: string }
  >
  axibridgeReposRemove(owner: string, repo: string): Promise<Array<{ owner: string; repo: string }>>
  /** Per-repo health: run counts, last run, cached reports, and any fetch error. */
  axibridgeStatus(): Promise<
    | {
        ok: true
        repos: Array<{
          repo: string
          runs: number
          firstRun: string | null
          lastRun: string | null
          cachedReports: number
          lastIndexFetch: number | null
          error: string | null
        }>
      }
    | { ok: false; error: string }
  >
  /** Start GitHub OAuth device flow: returns the user code + opens the verification page. */
  githubAuthBegin(): Promise<{
    userCode: string
    verificationUri: string
    deviceCode: string
    interval: number
    expiresIn: number
  }>
  /** Poll the device flow to completion, then file the token under its GitHub login. */
  githubAuthComplete(
    deviceCode: string,
    interval: number,
    expiresIn: number
  ): Promise<{ ok: boolean; login?: string; error?: string }>
  sendMessage(text: string): Promise<void>
  resetSession(): Promise<void>
  cancelTurn(): Promise<void>
  onAgentEvent(cb: (event: unknown) => void): () => void
  onConfirmRequest(cb: (req: unknown) => void): () => void
  respondConfirm(id: string, allowed: boolean): void
  windowControl(action: 'minimize' | 'maximize-toggle' | 'close'): void
  listKeys(service: 'gw2' | 'axivale' | 'gemini' | 'openai' | 'github'): Promise<Array<{ label: string; active: boolean }>>
  addKey(service: 'gw2' | 'axivale' | 'gemini' | 'openai' | 'github', label: string, key: string): Promise<void>
  removeKey(service: 'gw2' | 'axivale' | 'gemini' | 'openai' | 'github', label: string): Promise<void>
  setActiveKey(service: 'gw2' | 'axivale' | 'gemini' | 'openai' | 'github', label: string): Promise<void>
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
  onAxibridgeProgress(cb: (message: string) => void): () => void
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
