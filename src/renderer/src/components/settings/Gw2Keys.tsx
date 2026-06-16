import type { ReactElement } from 'react'
import { Pane, Card, Field, Keyring, type KeyLabel } from './ui'

export interface Gw2Info {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: Array<{ id: string; name: string; tag: string; leader: boolean }>
}

export interface Gw2KeysProps {
  gw2Keys: KeyLabel[]
  gw2Label: string
  gw2Key: string
  gw2Status: { msg: string; ok: boolean } | null
  gw2Info: Gw2Info | null
  gw2GuildId: string | null
  setGw2Label: (v: string) => void
  setGw2Key: (v: string) => void
  onActivate: (label: string) => void
  onRemove: (label: string) => void
  onAdd: () => void
  onPickGuild: (id: string) => void
}

export default function Gw2Keys(p: Gw2KeysProps): ReactElement {
  return (
    <Pane no="02" title="GW2 API Keys" sub="Guild Wars 2 account keys and the active guild.">
      <Card title="Keys">
        <Keyring keys={p.gw2Keys} onActivate={p.onActivate} onRemove={p.onRemove} />
        <Field label="Label">
          <input
            className="sfield-input"
            type="text"
            value={p.gw2Label}
            placeholder="e.g. main account"
            onChange={(e) => p.setGw2Label(e.target.value)}
          />
        </Field>
        <Field label="API key">
          <input
            className="sfield-input"
            type="password"
            value={p.gw2Key}
            placeholder="paste API key"
            onChange={(e) => p.setGw2Key(e.target.value)}
          />
        </Field>
        <div className="sactions">
          <button className="sbtn" disabled={!p.gw2Key} onClick={p.onAdd}>
            Add &amp; verify
          </button>
        </div>
        {p.gw2Status && (
          <div className={`sstatus ${p.gw2Status.ok ? 'ok' : 'err'}`}>{p.gw2Status.msg}</div>
        )}
      </Card>
      {p.gw2Info && (
        <Card title="Account">
          <div className="perm">
            Permissions: {p.gw2Info.permissions.join(', ') || '—'}
            {p.gw2Info.missingPermissions.length > 0 && (
              <div className="miss">Missing: {p.gw2Info.missingPermissions.join(', ')}</div>
            )}
          </div>
          {p.gw2Info.guilds.length > 0 && (
            <div className="schips" style={{ marginTop: '10px' }}>
              {p.gw2Info.guilds.map((g) => (
                <button
                  key={g.id}
                  className={`schip${p.gw2GuildId === g.id ? ' on' : ''}`}
                  onClick={() => p.onPickGuild(g.id)}
                >
                  {g.name}
                  {g.tag ? ` [${g.tag}]` : ''}
                  {g.leader ? ' (leader)' : ''}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </Pane>
  )
}
