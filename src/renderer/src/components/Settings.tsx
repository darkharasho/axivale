import { useEffect, useState, type ReactElement } from 'react'

interface Gw2Info {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: string[]
  guildLeader: string[]
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

export default function Settings({ onChanged }: SettingsProps): ReactElement {
  // Claude
  const [claudeToken, setClaudeToken] = useState('')
  const [claudeSaved, setClaudeSaved] = useState(false)
  const [claudeStatus, setClaudeStatus] = useState('')
  const [model, setModel] = useState('')

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

  async function refreshKeyLists(): Promise<void> {
    setGw2Keys(await window.officer.listKeys('gw2'))
    setAxiKeys(await window.officer.listKeys('axivale'))
  }

  useEffect(() => {
    void (async () => {
      setClaudeSaved(await window.officer.hasSecret('claudeOauthToken'))
      setModel((await window.officer.getSetting('model')) ?? '')
      setGw2GuildId(await window.officer.getSetting('gw2GuildId'))
      await refreshKeyLists()
    })()
  }, [])

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
        <h2>Claude</h2>
        <label className="slabel">OAuth token</label>
        <input
          className="sinput"
          type="password"
          value={claudeToken}
          placeholder={claudeSaved ? '•••••••• (saved)' : 'paste setup token'}
          onChange={(e) => setClaudeToken(e.target.value)}
        />
        <p className="shelp">
          Run <code>claude setup-token</code> in a terminal and paste the result. Leave empty to use
          this machine's existing Claude Code login.
        </p>
        <div className="srow">
          <button className="sbtn" disabled={!claudeToken} onClick={saveClaude}>
            File token
          </button>
        </div>
        <div className="sstatus ok">{claudeStatus || (claudeSaved ? 'token saved' : 'system login')}</div>
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
              onClick={() => pickModel(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
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
                {gw2Info.guilds.map((id) => (
                  <button
                    key={id}
                    className={`pi${gw2GuildId === id ? ' sel' : ''}`}
                    onClick={() => pickGw2Guild(id)}
                  >
                    {id}
                    {gw2Info.guildLeader.includes(id) && <span className="lead"> (leader)</span>}
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
    </div>
  )
}
