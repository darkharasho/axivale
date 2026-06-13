import { useEffect, useState, type ReactElement } from 'react'

type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'

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

  async function checkForge(): Promise<void> {
    setForgeStatus(null)
    setForgeStatus(await window.officer.axiforgeStatus())
  }

  async function refreshKeyLists(): Promise<void> {
    setGw2Keys(await window.officer.listKeys('gw2'))
    setAxiKeys(await window.officer.listKeys('axivale'))
    setGeminiKeys(await window.officer.listKeys('gemini'))
    setOpenaiKeys(await window.officer.listKeys('openai'))
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
      void checkForge()
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

  async function activateLlmKey(service: 'gemini' | 'openai', label: string): Promise<void> {
    await window.officer.setActiveKey(service, label)
    await refreshKeyLists()
    onChanged()
  }

  async function removeLlmKey(service: 'gemini' | 'openai', label: string): Promise<void> {
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
            {localModels.length > 0 && (
              <>
                <label className="slabel">Model</label>
                <div className="picker">
                  {localModels.map((m) => (
                    <button
                      key={m}
                      className={`pi${localModel === m ? ' sel' : ''}`}
                      onClick={() => pickProviderModel('local', m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="shelp">
              Runs entirely on this machine — free, private, no API key. Install Ollama from
              ollama.com, then run <code>ollama pull qwen3:8b</code>. Local models are slower and
              less reliable on multi-step tasks than the cloud providers.
            </p>
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
              file-only · AxiForge is closed — builds are read from disk; edits will start it
              headless
            </div>
          )}
          {forgeStatus?.state === 'offline' && (
            <div className="sstatus err">not found — install AxiForge via AxiOM</div>
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
