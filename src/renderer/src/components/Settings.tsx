import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { SettingsSection } from './settings/SettingsNav'
import Intelligence from './settings/Intelligence'
import Gw2Keys from './settings/Gw2Keys'
import AxiTools from './settings/AxiTools'
import AxiForge from './settings/AxiForge'
import ReportRepos from './settings/ReportRepos'
import Dispatches from './settings/Dispatches'
import About from './settings/About'

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
  section: SettingsSection
  onChanged: () => void
  onProviderChanged?: () => void
}

export default function Settings({
  section,
  onChanged,
  onProviderChanged
}: SettingsProps): ReactElement {
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
      {section === 'intelligence' && (
        <Intelligence
          provider={provider}
          onPickProvider={pickProvider}
          claudeToken={claudeToken}
          claudeSaved={claudeSaved}
          claudeStatus={claudeStatus}
          model={model}
          setClaudeToken={setClaudeToken}
          onSaveClaude={saveClaude}
          onPickModel={pickProviderModel}
          geminiKeys={geminiKeys}
          openaiKeys={openaiKeys}
          geminiModel={geminiModel}
          openaiModel={openaiModel}
          llmLabel={llmLabel}
          llmKey={llmKey}
          customModel={customModel}
          setLlmLabel={setLlmLabel}
          setLlmKey={setLlmKey}
          setCustomModel={setCustomModel}
          onAddLlmKey={addLlmKey}
          onActivateLlmKey={activateLlmKey}
          onRemoveLlmKey={removeLlmKey}
          geminiModels={GEMINI_MODELS}
          openaiModels={OPENAI_MODELS}
          localEndpoint={localEndpoint}
          localModel={localModel}
          localModels={localModels}
          localStatus={localStatus}
          hw={hw}
          chosenModel={chosenModel}
          ollamaBusy={ollamaBusy}
          ollamaErr={ollamaErr}
          ollamaStage={ollamaStage}
          ollamaPct={ollamaPct}
          pullingModel={pullingModel}
          setLocalEndpoint={setLocalEndpoint}
          setChosenModel={setChosenModel}
          onSaveLocalEndpoint={saveLocalEndpoint}
          onStartOllamaSetup={startOllamaSetup}
          onPullModel={pullModelIntoPicker}
        />
      )}
      {section === 'gw2' && (
        <Gw2Keys
          gw2Keys={gw2Keys}
          gw2Label={gw2Label}
          gw2Key={gw2Key}
          gw2Status={gw2Status}
          gw2Info={gw2Info}
          gw2GuildId={gw2GuildId}
          setGw2Label={setGw2Label}
          setGw2Key={setGw2Key}
          onActivate={activateGw2}
          onRemove={removeGw2}
          onAdd={addGw2Key}
          onPickGuild={pickGw2Guild}
        />
      )}
      {section === 'axitools' && (
        <AxiTools
          axiKeys={axiKeys}
          axiLabel={axiLabel}
          axiKey={axiKey}
          axiStatus={axiStatus}
          axiGuild={axiGuild}
          setAxiLabel={setAxiLabel}
          setAxiKey={setAxiKey}
          onActivate={activateAxi}
          onRemove={removeAxi}
          onAdd={addAxiKey}
        />
      )}
      {section === 'axiforge' && (
        <AxiForge
          forgeStatus={forgeStatus}
          forgeLaunching={forgeLaunching}
          onLaunch={launchForge}
          onRecheck={checkForge}
        />
      )}
      {section === 'repos' && (
        <ReportRepos
          bridgeRepos={bridgeRepos}
          bridgeHealth={bridgeHealth}
          bridgeInput={bridgeInput}
          bridgeStatus={bridgeStatus}
          bridgeFinding={bridgeFinding}
          githubKeys={githubKeys}
          ghSigningIn={ghSigningIn}
          ghUserCode={ghUserCode}
          ghCodeCopied={ghCodeCopied}
          ghAuthStatus={ghAuthStatus}
          setBridgeInput={setBridgeInput}
          onAddRepo={addBridgeRepo}
          onRemoveRepo={removeBridgeRepo}
          onDiscover={discoverAndLinkRepos}
          onCheckHealth={refreshBridgeHealth}
          onActivateKey={(label) => activateLlmKey('github', label)}
          onRemoveKey={(label) => removeLlmKey('github', label)}
          onSignIn={signInGithub}
          onCopyCode={copyGhCode}
        />
      )}
      {section === 'dispatches' && (
        <Dispatches shareEntries={shareEntries} onDelete={deleteShare} />
      )}
      {section === 'about' && (
        <About version={version} updateMsg={updateMsg} onCheckUpdates={checkUpdates} />
      )}
    </div>
  )
}
