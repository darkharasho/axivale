import { useState, type ReactElement, type KeyboardEvent } from 'react'
import type { RendererReconciledMember } from '../../../../preload/index.d'
import { Offline } from './shared'
import { STATUS_META, type RosterController, type RosterDraft } from './useRoster'

/** Inline chip editor for a string list (aliases / tags). Enter or comma commits. */
function ChipInput({
  values,
  onChange,
  placeholder
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
}): ReactElement {
  const [text, setText] = useState('')
  function commit(): void {
    const v = text.trim().replace(/,$/, '').trim()
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v])
    setText('')
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !text && values.length) {
      onChange(values.slice(0, -1))
    }
  }
  return (
    <div className="rst-chips">
      {values.map((v) => (
        <span key={v} className="rst-chip">
          {v}
          <b onClick={() => onChange(values.filter((x) => x !== v))}>✕</b>
        </span>
      ))}
      <input
        className="rst-chip-in"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
      />
    </div>
  )
}

function Badge({ tone, text }: { tone: 'ok' | 'warn' | 'dim'; text: string }): ReactElement {
  return (
    <span className={`rst-badge ${tone}`}>
      <span className="d" />
      {text}
    </span>
  )
}

function badges(m: RendererReconciledMember): ReactElement {
  const guild =
    m.inGuild
      ? <Badge key="g" tone="ok" text="In-game guild ✓" />
      : m.status === 'left-guild'
        ? <Badge key="g" tone="warn" text="Not in in-game guild" />
        : <Badge key="g" tone="dim" text="In-game unconfirmed" />
  return (
    <div className="rst-badges">
      {m.memberId ? (
        m.hasMemberRole ? (
          <Badge tone="ok" text="Member role" />
        ) : (
          <Badge tone="warn" text="No member role" />
        )
      ) : (
        <Badge tone="warn" text="No Discord match" />
      )}
      {m.linked ? <Badge tone="ok" text="GW2 key linked" /> : <Badge tone="warn" text="No GW2 key" />}
      {guild}
    </div>
  )
}

function resolvePreview(draft: RosterDraft, m: RendererReconciledMember): string {
  const terms = [draft.nickname, ...draft.aliases, m.discordName, m.displayName]
    .filter((x): x is string => Boolean(x && x.trim()))
    .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
  const acct = m.accounts[0]?.account_name
  if (!terms.length || !acct) return ''
  return `${terms.join(', ')} → ${acct}`
}

/** Detail editor for the selected roster member: reconciled identity + the local
 *  annotation editor. The master list lives in RosterNav; both share one controller. */
export default function Roster({ ctl }: { ctl: RosterController }): ReactElement {
  const { current, draft, setDraft, dirty, save, offline, loaded, error } = ctl

  if (offline) {
    return (
      <div className="sk2-detail sk2-blank">
        <Offline />
      </div>
    )
  }
  if (!current) {
    const msg = !loaded
      ? 'Reconciling the roster…'
      : ctl.members.length === 0
        ? 'No members yet. Connect a server in Settings, have members link their GW2 keys with the bot, and optionally set a guild-member role under Settings → AxiTools.'
        : 'Select a member.'
    return (
      <div className="sk2-detail sk2-blank">
        {error ? <div className="sstatus err">Roster error: {error}</div> : <div className="panel-empty">{msg}</div>}
      </div>
    )
  }

  const canAnnotate = Boolean(current.memberId)
  const preview = resolvePreview(draft, current)

  return (
    <div className="sk2-detail rst-detail">
      <div className="sk2-head">
        <div className="sk2-head-txt">
          <h1 className="rst-name">{draft.nickname || current.label}</h1>
          <div className="rst-sub">
            {current.discordName ? `@${current.discordName}` : 'in-game only'}
            {current.displayName && current.displayName !== current.discordName
              ? ` · "${current.displayName}" in Discord`
              : ''}
          </div>
        </div>
        <button className="sbtn" disabled={!canAnnotate || !dirty} onClick={() => void save()}>
          Save
        </button>
      </div>
      {badges(current)}

      <div className="spcard">
        <div className="spcard-h">
          <span className="spcard-t">Identity</span>
          <span className={`spcard-s ${STATUS_META[current.status].led === 'g' ? 'ok' : 'err'}`}>
            <span className="led" />
            {STATUS_META[current.status].sub}
          </span>
        </div>
        <div className="spcard-b rst-kvs">
          {current.discordName && (
            <div className="rst-kv">
              <span className="k">Discord</span>
              <span className="v">
                {current.discordName}
                {current.displayName ? ` · ${current.displayName}` : ''}
              </span>
            </div>
          )}
          <div className="rst-kv">
            <span className="k">GW2 account</span>
            <span className="v">
              {current.accounts.length
                ? current.accounts.map((a) => a.account_name).join(', ')
                : '— not linked'}
            </span>
          </div>
          {current.accounts.some((a) => a.characters.length > 0) && (
            <div className="rst-kv">
              <span className="k">Characters</span>
              <span className="v">{current.accounts.flatMap((a) => a.characters).join(', ')}</span>
            </div>
          )}
          {current.guildLabels.length > 0 && (
            <div className="rst-kv">
              <span className="k">Guilds</span>
              <span className="v">{current.guildLabels.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="spcard">
        <div className="spcard-h">
          <span className="spcard-t">Annotations — taught to the AI</span>
        </div>
        <div className="spcard-b">
          {!canAnnotate && (
            <p className="rst-hint">
              No Discord member to anchor an annotation. Tie this account to a Discord member first.
            </p>
          )}
          <fieldset className="rst-fields" disabled={!canAnnotate}>
            <div className="rst-field">
              <label className="rst-label">Nickname</label>
              <input
                className="rst-input"
                value={draft.nickname}
                placeholder="Preferred short name, e.g. Bob"
                onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
              />
            </div>
            <div className="rst-field">
              <label className="rst-label">Aliases</label>
              <ChipInput
                values={draft.aliases}
                onChange={(aliases) => setDraft({ ...draft, aliases })}
                placeholder="add an alias…"
              />
            </div>
            <div className="rst-field">
              <label className="rst-label">Notes (context for the AI)</label>
              <textarea
                className="rst-area"
                value={draft.notes}
                placeholder="Role, playstyle, timezone, anything worth knowing."
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="rst-field">
              <label className="rst-label">Tags</label>
              <ChipInput
                values={draft.tags}
                onChange={(tags) => setDraft({ ...draft, tags })}
                placeholder="add a tag…"
              />
            </div>
          </fieldset>
          {preview && (
            <div className="rst-resolve">
              AI can resolve <b>{preview}</b>
            </div>
          )}
        </div>
      </div>
      {error && <div className="sstatus err">{error}</div>}
    </div>
  )
}
