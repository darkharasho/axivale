import { useEffect, useState, type ReactElement } from 'react'

interface Gw2Info {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: string[]
  guildLeader: string[]
}

interface AxiGuild {
  id: number
  name: string
}

const AXI_DEFAULT = 'http://127.0.0.1:8642'

export interface SettingsProps {
  onChanged: () => void
}

export default function Settings({ onChanged }: SettingsProps): ReactElement {
  // Claude
  const [claudeToken, setClaudeToken] = useState('')
  const [claudeSaved, setClaudeSaved] = useState(false)
  const [claudeStatus, setClaudeStatus] = useState('')

  // GW2
  const [gw2Key, setGw2Key] = useState('')
  const [gw2Saved, setGw2Saved] = useState(false)
  const [gw2Status, setGw2Status] = useState<{ msg: string; ok: boolean } | null>(null)
  const [gw2Info, setGw2Info] = useState<Gw2Info | null>(null)
  const [gw2GuildId, setGw2GuildId] = useState<string | null>(null)

  // AxiTools
  const [axiUrl, setAxiUrl] = useState(AXI_DEFAULT)
  const [axiToken, setAxiToken] = useState('')
  const [axiTokenSaved, setAxiTokenSaved] = useState(false)
  const [axiStatus, setAxiStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [axiGuilds, setAxiGuilds] = useState<AxiGuild[]>([])
  const [axiGuildId, setAxiGuildId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setClaudeSaved(await window.officer.hasSecret('claudeOauthToken'))
      setGw2Saved(await window.officer.hasSecret('gw2ApiKey'))
      setAxiTokenSaved(await window.officer.hasSecret('axitoolsToken'))
      const url = await window.officer.getSetting('axitoolsUrl')
      if (url) setAxiUrl(url)
      setGw2GuildId(await window.officer.getSetting('gw2GuildId'))
      setAxiGuildId(await window.officer.getSetting('guildId'))
    })()
  }, [])

  async function saveClaude(): Promise<void> {
    await window.officer.setSecret('claudeOauthToken', claudeToken)
    setClaudeToken('')
    setClaudeSaved(true)
    setClaudeStatus('token saved')
    onChanged()
  }

  async function saveGw2(): Promise<void> {
    await window.officer.setSecret('gw2ApiKey', gw2Key)
    setGw2Key('')
    setGw2Saved(true)
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

  async function pickGw2Guild(id: string): Promise<void> {
    setGw2GuildId(id)
    await window.officer.setSetting('gw2GuildId', id)
    onChanged()
  }

  async function saveAxiUrl(): Promise<void> {
    await window.officer.setSetting('axitoolsUrl', axiUrl || AXI_DEFAULT)
    onChanged()
  }

  async function saveAxiToken(): Promise<void> {
    await window.officer.setSecret('axitoolsToken', axiToken)
    setAxiToken('')
    setAxiTokenSaved(true)
  }

  async function testAxi(): Promise<void> {
    await saveAxiUrl()
    if (axiToken) await saveAxiToken()
    setAxiStatus({ msg: 'connecting…', ok: true })
    const res = await window.officer.axitoolsStatus()
    if (res.ok) {
      setAxiGuilds(res.guilds ?? [])
      setAxiStatus({ msg: `connected · ${res.guilds?.length ?? 0} guild(s)`, ok: true })
    } else {
      setAxiGuilds([])
      setAxiStatus({ msg: res.error ?? 'connection failed', ok: false })
    }
    onChanged()
  }

  async function pickAxiGuild(id: number): Promise<void> {
    const s = String(id)
    setAxiGuildId(s)
    await window.officer.setSetting('guildId', s)
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
      </div>

      <div className="sgroup">
        <h2>GW2 API key</h2>
        <label className="slabel">API key</label>
        <input
          className="sinput"
          type="password"
          value={gw2Key}
          placeholder={gw2Saved ? '•••••••• (saved)' : 'paste API key'}
          onChange={(e) => setGw2Key(e.target.value)}
        />
        <div className="srow">
          <button className="sbtn" disabled={!gw2Key} onClick={saveGw2}>
            Save &amp; verify
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
        <label className="slabel">Server URL</label>
        <input
          className="sinput"
          type="text"
          value={axiUrl}
          placeholder={AXI_DEFAULT}
          onChange={(e) => setAxiUrl(e.target.value)}
        />
        <label className="slabel">Token</label>
        <input
          className="sinput"
          type="password"
          value={axiToken}
          placeholder={axiTokenSaved ? '•••••••• (saved)' : 'paste token'}
          onChange={(e) => setAxiToken(e.target.value)}
        />
        <div className="srow">
          <button className="sbtn" onClick={testAxi}>
            Test connection
          </button>
        </div>
        {axiStatus && (
          <div className={`sstatus ${axiStatus.ok ? 'ok' : 'err'}`}>{axiStatus.msg}</div>
        )}
        {axiGuilds.length > 0 && (
          <div className="picker">
            {axiGuilds.map((g) => (
              <button
                key={g.id}
                className={`pi${axiGuildId === String(g.id) ? ' sel' : ''}`}
                onClick={() => pickAxiGuild(g.id)}
              >
                {g.name} <span className="lead">· {g.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
