export interface RendererSessionState {
  claudeSessionId?: string
  history?: unknown[]
}

export interface RendererConversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  turns: unknown[]
  provider: 'claude' | 'gemini' | 'openai' | 'local'
  session: RendererSessionState
  seenTurnCount: number
}

export interface ShareListEntry {
  id: string
  kind: 'conversation' | 'response'
  title: string
  url: string
  sourceConversationId: string
  createdAt: string
}

export interface RendererMetaSource {
  label: string
  url: string
  status: 'ok' | 'error' | 'never'
  fetchedAt: string | null
  error: string | null
}
export interface RendererDerivedComp {
  window: { fromISO: string; toISO: string; days: number }
  sampleSize: number
  sourceRepos: string[]
  lowConfidence: boolean
  avgSquadSize: number
  supportPct: number
  professions: Array<{ name: string; avgPerSquad: number; presencePct: number; runAs: 'support' | 'damage' | 'mixed' }>
  subgroup: { core: string[]; flex: string[] }
}
export interface RendererPlaybook {
  derived: RendererDerivedComp | null
  derivedAt: string | null
  principles: string
  overrides: string
  blessed: boolean
}

export interface RendererMetaMode {
  id: string
  mode: string
  sources: RendererMetaSource[]
  notes: string
  playbook: RendererPlaybook
  refreshedAt: string | null
  updatedAt: string
}

// Detailed per-mode/per-source events for the Meta settings panel (busy + which
// source is fetching). The learning banner uses the coarser RendererLearnProgress.
export type RendererMetaProgress =
  | { type: 'refresh-start'; total: number }
  | { type: 'mode-start'; modeId: string }
  | { type: 'source-start'; modeId: string; url: string }
  | { type: 'source-done'; modeId: string; url: string }
  | { type: 'mode-done'; modeId: string }
  | { type: 'idle' }

// Coarse "learning" progress for the banner — the meta refresh AND the wiki
// reference ingest both report here. Each background job is a labelled phase;
// 'start' carries its total + label and every 'advance' moves that phase's bar.
export type RendererLearnProgress =
  | { phase: 'meta' | 'wiki'; kind: 'start'; total: number; label: string }
  | { phase: 'meta' | 'wiki'; kind: 'advance' }
  | { phase: 'meta' | 'wiki'; kind: 'done' }

export interface RendererMetaChunkRow {
  id: string
  mode: string
  source: string
  url: string
  title: string
  snippet: string
  text?: string
  indexedAt: string
}
export interface RendererMetaIndexStats {
  total: number
  byMode: Record<string, number>
  bySource: Record<string, number>
  lastIndexedAt: string | null
}
export interface RendererMetaSearchHit {
  source: string
  url: string
  title: string
  snippet: string
  text?: string
  score: number
}

export interface RendererSkill {
  id: string
  name: string
  whenToUse: string
  instructions: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RendererRosterAnnotation {
  memberId: string
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

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
  axiforgeLaunch(): Promise<{ ok: boolean; error?: string }>
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
  /** Scan the signed-in GitHub account for report repos (those with reports/index.json). */
  githubDiscoverRepos(): Promise<{
    ok: boolean
    repos?: Array<{ owner: string; repo: string }>
    error?: string
  }>
  /** Publish a full conversation; returns its public URL (live=true once Pages serves it). */
  shareConversation(conversationId: string): Promise<{ ok: true; url: string; live: boolean } | { ok: false; error: string }>
  /** Publish a single AI response; returns its public URL (live=true once Pages serves it). */
  shareResponse(conversationId: string, turnId: number): Promise<{ ok: true; url: string; live: boolean } | { ok: false; error: string }>
  shareList(): Promise<ShareListEntry[]>
  shareDelete(id: string): Promise<{ ok: boolean; error?: string }>
  shareStatus(): Promise<{ signedIn: boolean; repoReady: boolean; pagesUrl: string | null }>
  sendMessage(conversationId: string, text: string, forcedSkillId?: string): Promise<void>
  metaList(): Promise<RendererMetaMode[]>
  metaAddMode(seed: { mode: string; sources: RendererMetaSource[]; notes?: string }): Promise<RendererMetaMode>
  metaUpdateMode(
    id: string,
    patch: Partial<{ mode: string; sources: RendererMetaSource[]; notes: string }>
  ): Promise<RendererMetaMode | null>
  metaRemoveMode(id: string): Promise<void>
  metaForceRefresh(): Promise<void>
  metaUpdatePlaybook(id: string, patch: { principles?: string; overrides?: string; blessed?: boolean }): Promise<RendererMetaMode | null>
  metaDeriveComp(id: string): Promise<{ ok: boolean; error?: string; mode?: RendererMetaMode }>
  metaIndexStats(): Promise<RendererMetaIndexStats>
  metaIndexSample(opts: { mode?: string; limit: number }): Promise<RendererMetaChunkRow[]>
  metaIndexSearch(query: string, mode?: string): Promise<RendererMetaSearchHit[]>
  wikiIndexStats(): Promise<RendererMetaIndexStats>
  wikiIndexSample(opts: { mode?: string; limit: number }): Promise<RendererMetaChunkRow[]>
  wikiIndexSearch(query: string, mode?: string): Promise<RendererMetaSearchHit[]>
  skillsList(): Promise<RendererSkill[]>
  skillsCreate(seed: { name: string; whenToUse: string; instructions: string }): Promise<RendererSkill>
  skillsUpdate(
    id: string,
    patch: Partial<{ name: string; whenToUse: string; instructions: string; enabled: boolean }>
  ): Promise<RendererSkill | null>
  skillsDelete(id: string): Promise<void>
  rosterAnnotationsList(): Promise<RendererRosterAnnotation[]>
  rosterAnnotationUpsert(
    memberId: string,
    patch: Partial<{ nickname: string; aliases: string[]; notes: string; tags: string[] }>
  ): Promise<RendererRosterAnnotation | null>
  rosterAnnotationDelete(memberId: string): Promise<void>
  resetSession(conversationId: string): Promise<void>
  cancelTurn(conversationId: string): Promise<void>
  listConversations(): Promise<RendererConversation[]>
  getConversation(id: string): Promise<RendererConversation | null>
  createConversation(seed?: Partial<RendererConversation>): Promise<RendererConversation>
  saveTurns(id: string, turns: unknown[]): Promise<void>
  renameConversation(id: string, title: string | null): Promise<void>
  deleteConversation(id: string): Promise<void>
  setActiveConversation(id: string): Promise<void>
  markConversationSeen(id: string, count: number): Promise<void>
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
  onMetaProgress(cb: (e: RendererMetaProgress) => void): () => void
  onLearnProgress(cb: (e: RendererLearnProgress) => void): () => void
  ollamaDetectHardware(): Promise<{ totalRamGb: number; recommendedModel: string; modelOptions: string[] }>
  ollamaGetStatus(): Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
  ollamaInstall(): Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
  ollamaPullModel(model: string): Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
  ollamaUninstall(): Promise<{ installed: boolean; serverRunning: boolean; version: string | null; model: string | null }>
  onOllamaProgress(
    cb: (p: { kind: string; stage?: string; status?: string; percent?: number }) => void
  ): () => void
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
