import type { ReactElement } from 'react'
import { Pane, Card, Field, Keyring, type KeyLabel } from '../panelui'
import GuildMemberRoleField from './GuildMemberRoleField'

export interface AxiGuild {
  id: string
  name: string
}

export interface AxiToolsProps {
  axiKeys: KeyLabel[]
  axiLabel: string
  axiKey: string
  axiStatus: { msg: string; ok: boolean } | null
  axiGuild: AxiGuild | null
  setAxiLabel: (v: string) => void
  setAxiKey: (v: string) => void
  onActivate: (label: string) => void
  onRemove: (label: string) => void
  onAdd: () => void
}

export default function AxiTools(p: AxiToolsProps): ReactElement {
  return (
    <Pane
      no="03"
      title="AxiTools"
      sub="Discord server keys. The active key decides which server AxiVale acts on."
    >
      <Card title="Server keys">
        <Keyring keys={p.axiKeys} onActivate={p.onActivate} onRemove={p.onRemove} />
        <Field label="Label">
          <input
            className="sfield-input"
            type="text"
            value={p.axiLabel}
            placeholder="e.g. EWW server"
            onChange={(e) => p.setAxiLabel(e.target.value)}
          />
        </Field>
        <Field
          label="Key"
          help={
            <>
              In each Discord server, run <code>/config apikey generate</code> (requires Manage
              Server) and add the key here.
            </>
          }
        >
          <input
            className="sfield-input"
            type="password"
            value={p.axiKey}
            placeholder="paste key from Discord"
            onChange={(e) => p.setAxiKey(e.target.value)}
          />
        </Field>
        <div className="sactions">
          <button className="sbtn" disabled={!p.axiKey} onClick={p.onAdd}>
            Add &amp; connect
          </button>
        </div>
        {p.axiStatus && (
          <div className={`sstatus ${p.axiStatus.ok ? 'ok' : 'err'}`}>{p.axiStatus.msg}</div>
        )}
        {p.axiGuild && (
          <div className="perm">
            Bound to <b>{p.axiGuild.name}</b> · {p.axiGuild.id}
          </div>
        )}
      </Card>
      <Card title="Guild roster">
        <GuildMemberRoleField key={p.axiGuild?.id ?? 'none'} guildId={p.axiGuild?.id ?? null} />
      </Card>
    </Pane>
  )
}
