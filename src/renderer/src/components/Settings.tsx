import { useEffect, useRef, useState, type ReactElement } from 'react'

type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'
type KeyService = 'gw2' | 'axivale' | 'gemini' | 'openai' | 'github'

const PROVIDERS: Array<{ value: ProviderName; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'local', label: 'Local' }
]

// Verified against provider docs at implementation time (June 2026).
const GEMINI_MODELS = [
  { value: '', label: 'Default' },
  { value: 'gemini-2.5-flash', label: 'Flash' },
  { value: 'gemini-2.5-pro', label: 'Pro' }
]
const OPENAI_MODELS = [
  { value: '', label: 'Default' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' }
]
const MODEL_SETTING: Record<ProviderName, string> = {
  claude: 'model',
  gemini: 'geminiModel',
  openai: 'openaiModel',
  local: 'localModel'
}

interface Gw2Info {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: Array<{ id: string; name: string; tag: string; leader: boolean }>
}

interface AxiGuild {
  id: string
  name: string
}

interface KeyLabel {
  label: string
  active: boolean
}

export interface SettingsProps {
  onChanged: () => void
  onProviderChanged?: () => void
}

/** Saved-key switcher: click a label to activate, ✕ to remove. */
function Keyring({
  keys,
  onActivate,
  onRemove
}: {
  keys: KeyLabel[]
  onActivate: (label: string) => void
  onRemove: (label: string) => void
}): ReactElement | null {
  if (keys.length === 0) return null
  return (
    <div className="picker">
      {keys.map((k) => (
        <button
          key={k.label}
          className={`pi${k.active ? ' sel' : ''}`}
          onClick={() => onActivate(k.label)}
        >
          {k.label}
          {k.active && <span className="lead"> · active</span>}
          <span
            className="kx"
            title={`Remove "${k.label}"`}
            onClick={(e) => {
              e.stopPropagation()
              onRemove(k.label)
            }}
          >
            ✕
          </span>
        </button>
      ))}
    </div>
  )
}

export default function Settings({ onChanged, onProviderChanged }: SettingsProps): ReactElement {
  // Claude
  const [claudeToken, setClaudeToken] = useState('')
  const [claudeSaved, setClaudeSaved] = useState(false)
  const [claudeStatus, setClaudeStatus] = useState('')
  const [model, setModel] = useState('')

  // Provider
  const [provider, setProvider] = useState<ProviderName>('claude')
  const [geminiModel, setGeminiModel] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [customModel, setCustomModel] = useState('')

  // Gemini / OpenAI keyrings
  const [geminiKeys, setGeminiKeys] = useState<KeyLabel[]>([])
  const [openaiKeys, setOpenaiKeys] = useState<KeyLabel[]>([])
  const [llmLabel, setLlmLabel] = useState('')
  const [llmKey, setLlmKey] = useState('')

  // Local
  const [localEndpoint, setLocalEndpoint] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localStatus, setLocalStatus] = useState<{ msg: string; ok: boolean } | null>(null)

  // Ollama one-click setup wizard
  const [ollamaBusy, setOllamaBusy] = useState(false)
  const [ollamaStage, setOllamaStage] = useState<string>('')
  const [ollamaPct, setOllamaPct] = useState<number | null>(null)
  const [ollamaErr, setOllamaErr] = useState<string | null>(null)
  const [hw, setHw] = useState<{
    totalRamGb: number
    recommendedModel: string
    modelOptions: string[]
  } | null>(null)
  const [chosenModel, setChosenModel] = useState<string>('')
  const [pullingModel, setPullingModel] = useState<string | null>(null)

  // App / updates
  const [version, setVersion] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')

  // GW2
  const [gw2Keys, setGw2Keys] = useState<KeyLabel[]>([])
  const [gw2Label, setGw2Label] = useState('')
  const [gw2Key, setGw2Key] = useState('')
  const [gw2Status, setGw2Status] = useState<{ msg: string; ok: boolean } | null>(null)
  const [gw2Info, setGw2Info] = useState<Gw2Info | null>(null)
  const [gw2GuildId, setGw2GuildId] = useState<string | null>(null)

  // AxiTools
  const [axiKeys, setAxiKeys] = useState<KeyLabel[]>([])
  const [axiLabel, setAxiLabel] = useState('')
  const [axiKey, setAxiKey] = useState('')
  const [axiStatus, setAxiStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [axiGuild, setAxiGuild] = useState<AxiGuild | null>(null)

  // AxiForge
  const [forgeStatus, setForgeStatus] = useState<
    { state: 'connected'; version: string } | { state: 'file-only' } | { state: 'offline' } | null
  >(null)

  const [forgeLaunching, setForgeLaunching] = useState(false)

  async function checkForge(): Promise<void> {
    setForgeStatus(null)
    setForgeStatus(await window.officer.axiforgeStatus())
  }

  // Start AxiForge on demand (headless, or its dev server in dev), then re-check.
  async function launchForge(): Promise<void> {
    setForgeLaunching(true)
    try {
      await window.officer.axiforgeLaunch()
    } finally {
      setForgeLaunching(false)
      await checkForge()
    }
  }

  // AxiBridge
  const autoDiscovered = useRef(false)
  const [bridgeRepos, setBridgeRepos] = useState<Array<{ owner: string; repo: string }>>([])
  const [bridgeInput, setBridgeInput] = useState('')
  const [bridgeStatus, setBridgeStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [bridgeFinding, setBridgeFinding] = useState(false)
  const [bridgeHealth, setBridgeHealth] = useState<
    Array<{
      repo: string
      runs: number
      lastRun: string | null
      cachedReports: number
      lastIndexFetch: number | null
      error: string | null
    }>
  >([])
  const [githubKeys, setGithubKeys] = useState<KeyLabel[]>([])
  // GitHub OAuth device-flow sign-in state.
  const [ghSigningIn, setGhSigningIn] = useState(false)
  const [ghUserCode, setGhUserCode] = useState('')
  const [ghCodeCopied, setGhCodeCopied] = useState(false)
  const [ghAuthStatus, setGhAuthStatus] = useState<{ msg: string; ok: boolean } | null>(null)

  // Shared dispatches published to the GitHub Pages share site.
  const [shareEntries, setShareEntries] = useState<
    Array<{ id: string; kind: string; title: string; url: string; createdAt: string }>
  >([])

  async function refreshShares(): Promise<void> {
    setShareEntries(await window.officer.shareList())
  }

  async function deleteShare(id: string): Promise<void> {
    if (!window.confirm('Delete this share? The public link will stop working.')) return
    const res = await window.officer.shareDelete(id)
    if (res.ok) await refreshShares()
    else window.alert(res.error ?? 'Could not delete the share.')
  }

  async function copyGhCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(ghUserCode)
      setGhCodeCopied(true)
      setTimeout(() => setGhCodeCopied(false), 1500)
    } catch {
      // clipboard unavailable — the code is still shown for manual entry
    }
  }

  async function refreshBridgeHealth(): Promise<void> {
    const res = await window.officer.axibridgeStatus()
    if (res.ok) setBridgeHealth(res.repos)
  }

  async function addBridgeRepo(): Promise<void> {
    const res = await window.officer.axibridgeReposAdd(bridgeInput)
    if (!res.ok) {
      setBridgeStatus({ msg: res.error ?? 'invalid repo', ok: false })
      return
    }
    setBridgeRepos(res.repos)
    setBridgeInput('')
    setBridgeStatus({ msg: 'repo linked', ok: true })
    await refreshBridgeHealth()
    onChanged()
  }

  async function removeBridgeRepo(owner: string, repo: string): Promise<void> {
    setBridgeRepos(await window.officer.axibridgeReposRemove(owner, repo))
    onChanged()
  }

  // Discover report repos from the signed-in GitHub account and link any that
  // aren't already linked (reusing the repos-add handler as the single writer).
  async function discoverAndLinkRepos(): Promise<void> {
    setBridgeFinding(true)
    setBridgeStatus({ msg: 'Searching your GitHub repos…', ok: true })
    try {
      const res = await window.officer.githubDiscoverRepos()
      if (!res.ok) {
        setBridgeStatus({ msg: res.error ?? 'Could not search your GitHub repos.', ok: false })
        return
      }
      const found = res.repos ?? []
      const existing = await window.officer.axibridgeReposList()
      const isLinked = (r: { owner: string; repo: string }): boolean =>
        existing.some((e) => e.owner === r.owner && e.repo === r.repo)
      let linked = 0
      for (const r of found) {
        if (isLinked(r)) continue
        const add = await window.officer.axibridgeReposAdd(`${r.owner}/${r.repo}`)
        if (add.ok) linked += 1
      }
      setBridgeRepos(await window.officer.axibridgeReposList())
      await refreshBridgeHealth()
      if (found.length === 0) {
        setBridgeStatus({ msg: 'Signed in — no report repos found; add one below.', ok: true })
      } else {
        setBridgeStatus({ msg: `Linked ${linked} report repo(s) from your GitHub account`, ok: true })
      }
      onChanged()
    } catch (err) {
      setBridgeStatus({ msg: err instanceof Error ? err.message : String(err), ok: false })
    } finally {
      setBridgeFinding(false)
    }
  }

  // GitHub OAuth device flow: open the verification page, show the user code,
  // then poll to completion and refresh the keyring with the signed-in account.
  async function signInGithub(): Promise<void> {
    setGhSigningIn(true)
    setGhAuthStatus(null)
    setGhUserCode('')
    try {
      const begin = await window.officer.githubAuthBegin()
      setGhUserCode(begin.userCode)
      const res = await window.officer.githubAuthComplete(
        begin.deviceCode,
        begin.interval,
        begin.expiresIn
      )
      if (res.ok) {
        setGhUserCode('')
        setGhAuthStatus({ msg: `signed in · ${res.login ?? 'github'}`, ok: true })
        await refreshKeyLists()
        onChanged()
        // Auto-discover + link this account's report repos so linking isn't a
        // separate manual step after signing in.
        await discoverAndLinkRepos()
      } else {
        setGhUserCode('')
        setGhAuthStatus({ msg: res.error ?? 'sign-in failed', ok: false })
      }
    } catch (err) {
      setGhUserCode('')
      setGhAuthStatus({ msg: err instanceof Error ? err.message : String(err), ok: false })
    } finally {
      setGhSigningIn(false)
    }
  }

  async function refreshKeyLists(): Promise<void> {
    setGw2Keys(await window.officer.listKeys('gw2'))
    setAxiKeys(await window.officer.listKeys('axivale'))
    setGeminiKeys(await window.officer.listKeys('gemini'))
    setOpenaiKeys(await window.officer.listKeys('openai'))
    setGithubKeys(await window.officer.listKeys('github'))
  }

  useEffect(() => {
    void (async () => {
      setClaudeSaved(await window.officer.hasSecret('claudeOauthToken'))
      setModel((await window.officer.getSetting('model')) ?? '')
      setProvider(((await window.officer.getSetting('provider')) as ProviderName) ?? 'claude')
      setGeminiModel((await window.officer.getSetting('geminiModel')) ?? '')
      setOpenaiModel((await window.officer.getSetting('openaiModel')) ?? '')
      setLocalEndpoint((await window.officer.getSetting('localEndpoint')) ?? '')
      setLocalModel((await window.officer.getSetting('localModel')) ?? '')
      setGw2GuildId(await window.officer.getSetting('gw2GuildId'))
      setVersion(await window.officer.appVersion())
      await refreshKeyLists()
      void refreshShares()
      void checkForge()
      const repos = await window.officer.axibridgeReposList()
      setBridgeRepos(repos)
      void refreshBridgeHealth()
      // Signed in to GitHub but nothing linked yet → discover automatically
      // (once per session) so the user never has to click "Find my report repos".
      const ghKeys = await window.officer.listKeys('github')
      if (!autoDiscovered.current && ghKeys.length > 0 && repos.length === 0) {
        autoDiscovered.current = true
        void discoverAndLinkRepos()
      }
    })()
  }, [])

  useEffect(
    () =>
      window.officer.onUpdateStatus((s) => {
        const st = s as { state: string; version?: string; percent?: number; message?: string }
        if (st.state === 'checking') setUpdateMsg('checking…')
        else if (st.state === 'available') setUpdateMsg(`downloading v${st.version}…`)
        else if (st.state === 'downloading') setUpdateMsg(`downloading… ${st.percent}%`)
        else if (st.state === 'ready') setUpdateMsg(`v${st.version} ready — restart to install`)
        else if (st.state === 'none') setUpdateMsg('up to date')
        else if (st.state === 'error') setUpdateMsg(`update check failed: ${st.message}`)
      }),
    []
  )

  useEffect(() => {
    const off = window.officer.onOllamaProgress((p) => {
      setOllamaStage(p.stage || p.status || '')
      setOllamaPct(typeof p.percent === 'number' ? p.percent : null)
    })
    return off
  }, [])

  useEffect(() => {
    window.officer.ollamaDetectHardware().then((info) => {
      setHw(info)
      setChosenModel((cur) => cur || info.recommendedModel)
    })
  }, [])

  const startOllamaSetup = async (): Promise<void> => {
    setOllamaErr(null)
    setOllamaBusy(true)
    try {
      const info = hw ?? (await window.officer.ollamaDetectHardware())
      setHw(info)
      const model = chosenModel || info.recommendedModel
      await window.officer.ollamaInstall()
      await window.officer.ollamaPullModel(model)
      // Refresh the local provider's installed-model list so the picker shows up.
      await checkLocal()
    } catch (e) {
      setOllamaErr(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setOllamaBusy(false)
      setOllamaPct(null)
    }
  }

  // Pull a model that isn't installed yet straight from the picker, then make
  // it the active local model.
  const pullModelIntoPicker = async (model: string): Promise<void> => {
    setOllamaErr(null)
    setOllamaBusy(true)
    setPullingModel(model)
    try {
      await window.officer.ollamaPullModel(model)
      await checkLocal()
      await pickProviderModel('local', model)
    } catch (e) {
      setOllamaErr(e instanceof Error ? e.message : `Failed to download ${model}`)
    } finally {
      setOllamaBusy(false)
      setPullingModel(null)
      setOllamaPct(null)
    }
  }

  async function checkUpdates(): Promise<void> {
    setUpdateMsg('checking…')
    await window.officer.checkUpdates()
  }

  async function saveClaude(): Promise<void> {
    await window.officer.setSecret('claudeOauthToken', claudeToken)
    setClaudeToken('')
    setClaudeSaved(true)
    setClaudeStatus('token saved')
    onChanged()
  }

  async function pickModel(value: string): Promise<void> {
    setModel(value)
    await window.officer.setSetting('model', value)
    onChanged()
  }

  async function pickProvider(value: ProviderName): Promise<void> {
    const prev = provider
    setProvider(value)
    setLlmLabel('')
    setLlmKey('')
    setCustomModel('')
    await window.officer.setSetting('provider', value)
    if (value === 'local') await checkLocal()
    if (value !== prev) onProviderChanged?.()
    onChanged()
  }

  async function pickProviderModel(p: ProviderName, value: string): Promise<void> {
    if (p === 'gemini') setGeminiModel(value)
    else if (p === 'openai') setOpenaiModel(value)
    else if (p === 'local') setLocalModel(value)
    else setModel(value)
    await window.officer.setSetting(MODEL_SETTING[p], value)
    onChanged()
  }

  async function addLlmKey(service: 'gemini' | 'openai'): Promise<void> {
    await window.officer.addKey(service, llmLabel.trim() || 'unnamed', llmKey)
    setLlmLabel('')
    setLlmKey('')
    await refreshKeyLists()
    onChanged()
  }

  async function activateLlmKey(service: KeyService, label: string): Promise<void> {
    await window.officer.setActiveKey(service, label)
    await refreshKeyLists()
    onChanged()
  }

  async function removeLlmKey(service: KeyService, label: string): Promise<void> {
    await window.officer.removeKey(service, label)
    await refreshKeyLists()
    onChanged()
  }

  async function saveLocalEndpoint(): Promise<void> {
    await window.officer.setSetting('localEndpoint', localEndpoint.trim())
    await checkLocal()
    onChanged()
  }

  async function checkLocal(): Promise<void> {
    setLocalStatus({ msg: 'probing…', ok: true })
    const res = await window.officer.localStatus()
    if (res.ok) {
      setLocalModels(res.models ?? [])
      setLocalStatus({
        msg: res.models?.length
          ? `connected · ${res.models.length} model${res.models.length === 1 ? '' : 's'}`
          : 'connected · no models installed — run: ollama pull qwen3:8b',
        ok: true
      })
    } else {
      setLocalModels([])
      setLocalStatus({ msg: res.error ?? 'no local server', ok: false })
    }
  }

  // Validate whichever GW2 key is now active and surface the result.
  async function verifyActiveGw2(): Promise<void> {
    setGw2Status({ msg: 'validating…', ok: true })
    const res = await window.officer.validateGw2Key()
    if (res.ok && res.info) {
      const info = res.info as Gw2Info
      setGw2Info(info)
      await window.officer.setSetting('gw2AccountName', info.accountName)
      setGw2Status({ msg: `verified · ${info.accountName}`, ok: true })
    } else {
      setGw2Info(null)
      setGw2Status({ msg: res.error ?? 'validation failed', ok: false })
    }
    onChanged()
  }

  async function addGw2Key(): Promise<void> {
    await window.officer.addKey('gw2', gw2Label.trim() || 'unnamed', gw2Key)
    setGw2Label('')
    setGw2Key('')
    await refreshKeyLists()
    await verifyActiveGw2()
  }

  async function activateGw2(label: string): Promise<void> {
    await window.officer.setActiveKey('gw2', label)
    await refreshKeyLists()
    await verifyActiveGw2()
  }

  async function removeGw2(label: string): Promise<void> {
    await window.officer.removeKey('gw2', label)
    await refreshKeyLists()
    onChanged()
  }

  async function pickGw2Guild(id: string): Promise<void> {
    setGw2GuildId(id)
    await window.officer.setSetting('gw2GuildId', id)
    // Persist a display name too so the masthead switcher can show the active
    // guild without a network round-trip on load.
    const g = gw2Info?.guilds.find((guild) => guild.id === id)
    if (g) await window.officer.setSetting('gw2GuildName', g.name + (g.tag ? ` [${g.tag}]` : ''))
    onChanged()
  }

  // Connect with whichever AxiVale key is now active.
  async function connectActiveAxi(): Promise<void> {
    setAxiStatus({ msg: 'connecting…', ok: true })
    const res = await window.officer.axitoolsStatus()
    if (res.ok && res.guilds && res.guilds.length > 0) {
      setAxiGuild(res.guilds[0])
      setAxiStatus({ msg: `connected · ${res.guilds[0].name}`, ok: true })
    } else {
      setAxiGuild(null)
      setAxiStatus({ msg: res.error ?? 'connection failed', ok: false })
    }
    onChanged()
  }

  async function addAxiKey(): Promise<void> {
    await window.officer.addKey('axivale', axiLabel.trim() || 'unnamed', axiKey)
    setAxiLabel('')
    setAxiKey('')
    await refreshKeyLists()
    await connectActiveAxi()
  }

  async function activateAxi(label: string): Promise<void> {
    await window.officer.setActiveKey('axivale', label)
    await refreshKeyLists()
    await connectActiveAxi()
  }

  async function removeAxi(label: string): Promise<void> {
    await window.officer.removeKey('axivale', label)
    await refreshKeyLists()
    onChanged()
  }

  return (
    <div className="settings">
      <div className="sgroup">
        <h2>Intelligence</h2>
        <label className="slabel">Provider</label>
        <div className="picker">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              className={`pi${provider === p.value ? ' sel' : ''}`}
              onClick={() => pickProvider(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {provider === 'claude' && (
          <>
            <label className="slabel">OAuth token</label>
            <input
              className="sinput"
              type="password"
              value={claudeToken}
              placeholder={claudeSaved ? '•••••••• (saved)' : 'paste setup token'}
              onChange={(e) => setClaudeToken(e.target.value)}
            />
            <p className="shelp">
              Run <code>claude setup-token</code> in a terminal and paste the result. Leave empty to
              use this machine's existing Claude Code login.
            </p>
            <div className="srow">
              <button className="sbtn" disabled={!claudeToken} onClick={saveClaude}>
                File token
              </button>
            </div>
            <div className="sstatus ok">
              {claudeStatus || (claudeSaved ? 'token saved' : 'system login')}
            </div>
            <label className="slabel">Model</label>
            <div className="picker">
              {[
                { value: '', label: 'Default' },
                { value: 'haiku', label: 'Haiku' },
                { value: 'sonnet', label: 'Sonnet' },
                { value: 'opus', label: 'Opus' }
              ].map((m) => (
                <button
                  key={m.value}
                  className={`pi${model === m.value ? ' sel' : ''}`}
                  onClick={() => pickProviderModel('claude', m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}

        {(provider === 'gemini' || provider === 'openai') && (
          <>
            <label className="slabel">API keys</label>
            <Keyring
              keys={provider === 'gemini' ? geminiKeys : openaiKeys}
              onActivate={(label) => activateLlmKey(provider, label)}
              onRemove={(label) => removeLlmKey(provider, label)}
            />
            <input
              className="sinput"
              type="text"
              value={llmLabel}
              placeholder="label, e.g. personal"
              onChange={(e) => setLlmLabel(e.target.value)}
            />
            <input
              className="sinput"
              type="password"
              value={llmKey}
              placeholder={provider === 'gemini' ? 'paste Gemini API key' : 'paste OpenAI API key'}
              onChange={(e) => setLlmKey(e.target.value)}
            />
            <p className="shelp">
              {provider === 'gemini' ? (
                <>Create a free key at aistudio.google.com → Get API key.</>
              ) : (
                <>Create a key at platform.openai.com → API keys.</>
              )}
            </p>
            <div className="srow">
              <button className="sbtn" disabled={!llmKey} onClick={() => addLlmKey(provider)}>
                Add key
              </button>
            </div>
            <label className="slabel">Model</label>
            <div className="picker">
              {(provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS).map((m) => (
                <button
                  key={m.value}
                  className={`pi${(provider === 'gemini' ? geminiModel : openaiModel) === m.value ? ' sel' : ''}`}
                  onClick={() => pickProviderModel(provider, m.value)}
                >
                  {m.label}
                </button>
              ))}
              {(() => {
                const activeModel = provider === 'gemini' ? geminiModel : openaiModel
                const curated = provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS
                if (activeModel && !curated.some((m) => m.value === activeModel)) {
                  return (
                    <button key={activeModel} className="pi sel">
                      {activeModel}
                    </button>
                  )
                }
                return null
              })()}
            </div>
            <input
              className="sinput"
              type="text"
              value={customModel}
              placeholder="or type a custom model id and press Enter"
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customModel.trim()) {
                  void pickProviderModel(provider, customModel.trim())
                  setCustomModel('')
                }
              }}
            />
          </>
        )}

        {provider === 'local' && (
          <>
            <label className="slabel">Server</label>
            <input
              className="sinput"
              type="text"
              value={localEndpoint}
              placeholder="http://localhost:11434"
              onChange={(e) => setLocalEndpoint(e.target.value)}
            />
            <div className="srow">
              <button className="sbtn" onClick={saveLocalEndpoint}>
                Save &amp; probe
              </button>
            </div>
            {localStatus && (
              <div className={`sstatus ${localStatus.ok ? 'ok' : 'err'}`}>{localStatus.msg}</div>
            )}
            {localModels.length > 0 &&
              (() => {
                // Show recommended models alongside the installed ones so the user
                // can tell what's installed and pull a recommended model they lack.
                const recommended = hw?.modelOptions ?? []
                const rows = [...recommended, ...localModels.filter((m) => !recommended.includes(m))]
                return (
                  <>
                    <label className="slabel">Model</label>
                    <div className="picker">
                      {rows.map((m) => {
                        const installed = localModels.includes(m)
                        const isPulling = pullingModel === m
                        return (
                          <button
                            key={m}
                            className={`pi model-row${localModel === m ? ' sel' : ''}`}
                            disabled={ollamaBusy}
                            title={installed ? 'Installed' : 'Not installed — click to download'}
                            onClick={() =>
                              installed ? pickProviderModel('local', m) : pullModelIntoPicker(m)
                            }
                          >
                            <span className="model-name">{m}</span>
                            <span className={`model-tag${installed ? ' on' : ''}`}>
                              {isPulling
                                ? `downloading… ${ollamaPct ?? 0}%`
                                : installed
                                  ? '✓ installed'
                                  : '↓ download'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {ollamaErr && <div className="sstatus err">{ollamaErr}</div>}
                    <p className="shelp">
                      <span className="model-tag on">✓ installed</span> models are ready to use.
                      Click a <span className="model-tag">↓ download</span> model to fetch it. The
                      model with the accent border is active.
                    </p>
                  </>
                )
              })()}
            {localModels.length === 0 && (
              <div className="ollama-setup">
                {hw && (
                  <p className="shelp">
                    Detected {hw.totalRamGb} GB RAM — recommended <strong>{hw.recommendedModel}</strong>.
                  </p>
                )}
                {hw && (
                  <>
                    <label className="slabel">Model</label>
                    <div className="picker">
                      {hw.modelOptions.map((m) => (
                        <button
                          key={m}
                          className={`pi${chosenModel === m ? ' sel' : ''}`}
                          disabled={ollamaBusy}
                          onClick={() => setChosenModel(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="srow">
                  <button className="sbtn" disabled={ollamaBusy} onClick={startOllamaSetup}>
                    {ollamaBusy ? 'Setting up…' : 'Set up local AI (one click)'}
                  </button>
                </div>
                {ollamaBusy && (
                  <div className="ollama-progress">
                    <div className="sstatus">{ollamaStage}</div>
                    {ollamaPct !== null && <progress max={100} value={ollamaPct} />}
                  </div>
                )}
                {ollamaErr && (
                  <div className="sstatus err">
                    {ollamaErr}{' '}
                    <button className="sbtn out" onClick={startOllamaSetup}>
                      Retry
                    </button>
                  </div>
                )}
                <p className="shelp">
                  Installs a private, self-contained Ollama just for AxiVale — no admin rights,
                  nothing else on your system is touched. Or install it yourself from ollama.com
                  and run <code>ollama pull qwen3:8b</code>. Local models are slower and less
                  reliable on multi-step tasks than the cloud providers.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="sgroup">
        <h2>GW2 API keys</h2>
        <Keyring keys={gw2Keys} onActivate={activateGw2} onRemove={removeGw2} />
        <label className="slabel">Add a key</label>
        <input
          className="sinput"
          type="text"
          value={gw2Label}
          placeholder="label, e.g. main account"
          onChange={(e) => setGw2Label(e.target.value)}
        />
        <input
          className="sinput"
          type="password"
          value={gw2Key}
          placeholder="paste API key"
          onChange={(e) => setGw2Key(e.target.value)}
        />
        <div className="srow">
          <button className="sbtn" disabled={!gw2Key} onClick={addGw2Key}>
            Add &amp; verify
          </button>
        </div>
        {gw2Status && (
          <div className={`sstatus ${gw2Status.ok ? 'ok' : 'err'}`}>{gw2Status.msg}</div>
        )}
        {gw2Info && (
          <>
            <div className="perm">
              Permissions: {gw2Info.permissions.join(', ') || '—'}
              {gw2Info.missingPermissions.length > 0 && (
                <div className="miss">Missing: {gw2Info.missingPermissions.join(', ')}</div>
              )}
            </div>
            {gw2Info.guilds.length > 0 && (
              <div className="picker">
                {gw2Info.guilds.map((g) => (
                  <button
                    key={g.id}
                    className={`pi${gw2GuildId === g.id ? ' sel' : ''}`}
                    onClick={() => pickGw2Guild(g.id)}
                  >
                    {g.name}
                    {g.tag ? ` [${g.tag}]` : ''}
                    {g.leader && <span className="lead"> (leader)</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="sgroup">
        <h2>AxiTools</h2>
        <Keyring keys={axiKeys} onActivate={activateAxi} onRemove={removeAxi} />
        <label className="slabel">Add a key</label>
        <input
          className="sinput"
          type="text"
          value={axiLabel}
          placeholder="label, e.g. EWW server"
          onChange={(e) => setAxiLabel(e.target.value)}
        />
        <input
          className="sinput"
          type="password"
          value={axiKey}
          placeholder="paste key from Discord"
          onChange={(e) => setAxiKey(e.target.value)}
        />
        <p className="shelp">
          In each Discord server, run <code>/config apikey generate</code> (requires Manage
          Server) and add the key here. The active key decides which server AxiVale acts on.
        </p>
        <div className="srow">
          <button className="sbtn" disabled={!axiKey} onClick={addAxiKey}>
            Add &amp; connect
          </button>
        </div>
        {axiStatus && (
          <div className={`sstatus ${axiStatus.ok ? 'ok' : 'err'}`}>{axiStatus.msg}</div>
        )}
        {axiGuild && (
          <div className="perm">
            Bound to <b>{axiGuild.name}</b> · {axiGuild.id}
          </div>
        )}
      </div>

      <div className="sgroup">
        <h2>AxiForge</h2>
        <div className="srow">
          {forgeStatus === null && <div className="sstatus ok">checking…</div>}
          {forgeStatus?.state === 'connected' && (
            <div className="sstatus ok">connected · v{forgeStatus.version}</div>
          )}
          {forgeStatus?.state === 'file-only' && (
            <div className="sstatus ok">
              file-only · AxiForge is closed — builds are read from disk
            </div>
          )}
          {forgeStatus?.state === 'offline' && (
            <div className="sstatus err">not found — install AxiForge via AxiOM</div>
          )}
          {forgeStatus && forgeStatus.state !== 'connected' && forgeStatus.state !== 'offline' && (
            <button className="sbtn" disabled={forgeLaunching} onClick={launchForge}>
              {forgeLaunching ? 'Starting…' : 'Launch AxiForge'}
            </button>
          )}
          <button className="sbtn out" onClick={checkForge}>
            Recheck
          </button>
        </div>
        <p className="shelp">
          AxiVale edits AxiForge builds and comps through its local API. No setup needed — the
          connection is discovered automatically when AxiForge runs on this machine.
        </p>
      </div>

      <div className="sgroup">
        <h2>AxiBridge report repos</h2>
        {bridgeRepos.length > 0 && (
          <div className="picker">
            {bridgeRepos.map((r) => {
              const health = bridgeHealth.find((h) => h.repo === `${r.owner}/${r.repo}`)
              return (
                <button key={`${r.owner}/${r.repo}`} className="pi">
                  {r.owner}/{r.repo}
                  {health && !health.error && (
                    <span className="lead">
                      {' '}
                      · {health.runs} runs · {health.cachedReports} cached
                    </span>
                  )}
                  {health?.error && <span className="lead"> · unreachable</span>}
                  <span
                    className="kx"
                    title={`Unlink ${r.owner}/${r.repo}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeBridgeRepo(r.owner, r.repo)
                    }}
                  >
                    ✕
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <label className="slabel">Link a repo</label>
        <input
          className="sinput"
          type="text"
          value={bridgeInput}
          placeholder="owner/repo or https://owner.github.io/repo"
          onChange={(e) => setBridgeInput(e.target.value)}
        />
        <div className="srow">
          <button className="sbtn" disabled={!bridgeInput.trim()} onClick={addBridgeRepo}>
            Link repo
          </button>
          <button
            className="sbtn out"
            disabled={bridgeFinding || githubKeys.length === 0}
            onClick={discoverAndLinkRepos}
            title={
              githubKeys.length === 0 ? 'Sign in with GitHub below first' : 'Scan your GitHub account'
            }
          >
            {bridgeFinding ? 'Searching…' : 'Find my report repos'}
          </button>
          <button className="sbtn out" onClick={refreshBridgeHealth}>
            Check health
          </button>
        </div>
        {bridgeStatus && (
          <div className={`sstatus ${bridgeStatus.ok ? 'ok' : 'err'}`}>{bridgeStatus.msg}</div>
        )}

        {/* Account sub-section: clearly separated from the repo-link area above. */}
        <div
          className="subsection"
          style={{
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            paddingBottom: '2.5rem',
            borderTop: '1px dashed var(--rule)'
          }}
        >
          <h3 className="ssub">GitHub account</h3>
          <p className="shelp">
            Optional — for private repos / higher rate limits. Public report repos work without
            signing in.
          </p>
          <Keyring
            keys={githubKeys}
            onActivate={(label) => activateLlmKey('github', label)}
            onRemove={(label) => removeLlmKey('github', label)}
          />
          {ghUserCode && (
            <div className="sstatus ok">
              Enter code <b>{ghUserCode}</b>{' '}
              <button className="sbtn out" type="button" onClick={copyGhCode}>
                {ghCodeCopied ? 'copied ✓' : 'copy'}
              </button>{' '}
              at github.com/login/device (opened in your browser).
            </div>
          )}
          <div className="srow" style={{ marginTop: '12px' }}>
            <button className="sbtn" disabled={ghSigningIn} onClick={signInGithub}>
              {ghSigningIn ? 'Signing in…' : 'Sign in with GitHub'}
            </button>
          </div>
          {ghAuthStatus && (
            <div className={`sstatus ${ghAuthStatus.ok ? 'ok' : 'err'}`}>{ghAuthStatus.msg}</div>
          )}
        </div>
      </div>

      <div className="sgroup">
        <h2>Shared dispatches</h2>
        <p className="shelp">
          Public links you have published to your GitHub Pages share site. Deleting one removes it
          from the web.
        </p>
        {shareEntries.length === 0 ? (
          <div className="sstatus">You haven&apos;t shared anything yet.</div>
        ) : (
          <ul className="share-list">
            {shareEntries.map((s) => (
              <li key={s.id} className="share-list-row">
                <div className="share-list-meta">
                  <span className="share-list-title">{s.title || 'Untitled'}</span>
                  <span className="share-list-kind">{s.kind}</span>
                </div>
                <div className="share-list-acts">
                  <a className="sbtn out" href={s.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="sbtn out" onClick={() => void deleteShare(s.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sgroup">
        <h2>About</h2>
        <div className="srow">
          <div className="countline">
            AxiVale <b>v{version || '—'}</b>
          </div>
          <button className="sbtn out" onClick={checkUpdates}>
            Check for updates
          </button>
        </div>
        {updateMsg && <div className="sstatus ok">{updateMsg}</div>}
        <p className="shelp">
          Updates install automatically from GitHub releases; a banner appears when a new edition
          is ready.
        </p>
      </div>
    </div>
  )
}
