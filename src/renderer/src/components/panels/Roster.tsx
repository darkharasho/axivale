import { useState, type ReactElement, type KeyboardEvent } from 'react'
import type { RendererReconciledMember } from '../../../../preload/index.d'
import { Offline } from './shared'
import { SearchSelect } from './SearchSelect'
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
  return (
    <div className="rst-badges">
      {m.inGuild ? (
        <Badge tone="ok" text="In-game guild ✓" />
      ) : m.status === 'left-guild' ? (
        <Badge tone="warn" text="Not in in-game guild" />
      ) : (
        <Badge tone="dim" text="In-game unconfirmed" />
      )}
      {m.memberId ? (
        <Badge tone="ok" text={m.linkSource === 'manual' ? 'Discord linked (manual)' : 'Discord linked'} />
      ) : (
        <Badge tone="warn" text="No Discord — link one" />
      )}
      {m.accounts.length ? (
        <Badge tone="ok" text="GW2 account" />
      ) : (
        <Badge tone="warn" text="No GW2 account" />
      )}
      {m.hasMemberRole && <Badge tone="ok" text="Member role" />}
    </div>
  )
}

/** "Display Name (username)" when both are known, else whichever exists. */
function discordLabel(m: RendererReconciledMember): string {
  const d = m.displayName?.trim()
  const u = m.discordName?.trim()
  if (d && u && d !== u) return `${d} (${u})`
  return d || u || m.memberId || ''
}

function resolvePreview(draft: RosterDraft, m: RendererReconciledMember): string {
  const terms = [draft.nickname, ...draft.aliases, m.discordName, m.displayName]
    .filter((x): x is string => Boolean(x && x.trim()))
    .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
  const acct = m.accountName ?? m.accounts[0]?.account_name
  if (!terms.length || !acct) return ''
  return `${terms.join(', ')} → ${acct}`
}

/** Discord-link card: pick a Discord user for an unlinked GW2 account, or unlink a
 *  manual link. Auto links (from AxiTools) are shown read-only. */
function LinkCard({ ctl, m }: { ctl: RosterController; m: RendererReconciledMember }): ReactElement | null {
  if (!m.accountName) return null // only GW2-account rows are linkable here
  const options = ctl.discordMembers
    .map((d) => {
      const dn = d.display_name?.trim()
      const un = d.name?.trim()
      const label = dn && un && dn !== un ? `${dn} (${un})` : dn || un || d.id
      return {
        value: d.id,
        label,
        icon: d.avatar,
        initial: (dn || un || '?').charAt(0),
        search: `${dn ?? ''} ${un ?? ''}` // match display name AND username
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  return (
    <div className="spcard">
      <div className="spcard-h">
        <span className="spcard-t">Link a Discord user</span>
      </div>
      <div className="spcard-b">
        <p className="rst-hint">
          This GW2 account isn’t tied to a Discord user. Link one so notes and the AI can resolve them.
        </p>
        <SearchSelect
          value=""
          options={options}
          onChange={(memberId) => void ctl.link(m.accountName as string, memberId)}
          placeholder={options.length ? 'Pick a Discord user…' : 'No Discord members loaded'}
          searchPlaceholder="Find a Discord user…"
        />
      </div>
    </div>
  )
}

/** One GW2 account as its own card, with a per-account unlink when it was tied to
 *  this identity by a manual link. */
function AccountCard({
  acc,
  onUnlink
}: {
  acc: RendererReconciledMember['accounts'][number]
  onUnlink: () => void
}): ReactElement {
  return (
    <div className="spcard">
      <div className="spcard-h">
        <span className="spcard-t rst-acct">{acc.account_name}</span>
        {acc.manual && (
          <button className="rst-unlink" onClick={onUnlink}>
            Unlink
          </button>
        )}
      </div>
      <div className="spcard-b rst-kvs">
        <div className="rst-kv">
          <span className="k">In-game</span>
          <span className="v">
            {acc.inGuild
              ? `${acc.rank ?? 'member'}${acc.joined ? `, joined ${acc.joined.slice(0, 10)}` : ''}`
              : 'not in in-game guild'}
          </span>
        </div>
        {acc.characters.length > 0 && (
          <div className="rst-kv">
            <span className="k">Characters</span>
            <span className="v">{acc.characters.join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Detail editor for the selected roster member: reconciled identity, manual link,
 *  and the local annotation editor. */
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
        ? 'No members yet. Connect a server and set your GW2 guild + key in Settings so the in-game roster loads.'
        : 'Select a member.'
    return (
      <div className="sk2-detail sk2-blank">
        {error ? <div className="sstatus err">Roster error: {error}</div> : <div className="panel-empty">{msg}</div>}
      </div>
    )
  }

  const preview = resolvePreview(draft, current)

  return (
    <div className="sk2-detail rst-detail">
      <div className="sk2-head">
        <div className="sk2-head-txt">
          <h1 className="rst-name">{draft.nickname || current.label}</h1>
          <div className="rst-sub">
            {current.memberId
              ? `Discord: ${discordLabel(current)}`
              : current.accountName
                ? `${current.accountName} · no Discord link`
                : 'unlinked'}
          </div>
        </div>
        <button className="sbtn" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
      </div>
      {badges(current)}

      {(current.discordName || current.guildLabels.length > 0) && (
        <div className="spcard">
          <div className="spcard-h">
            <span className="spcard-t">Identity</span>
            <span className={`spcard-s ${STATUS_META[current.status].led === 'g' ? 'ok' : 'err'}`}>
              <span className="led" />
              {current.linkSource === 'manual' ? 'manual link' : STATUS_META[current.status].sub}
            </span>
          </div>
          <div className="spcard-b rst-kvs">
            {current.discordName && (
              <div className="rst-kv">
                <span className="k">Discord</span>
                <span className="v">{discordLabel(current)}</span>
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
      )}

      {current.accounts.length > 0 && (
        <div className="rst-section-label">
          {current.accounts.length > 1 ? `${current.accounts.length} accounts` : 'Account'}
        </div>
      )}
      {current.accounts.map((acc) => (
        <AccountCard key={acc.account_name} acc={acc} onUnlink={() => void ctl.unlink(acc.account_name)} />
      ))}

      <LinkCard ctl={ctl} m={current} />

      <div className="spcard">
        <div className="spcard-h">
          <span className="spcard-t">Annotations — taught to the AI</span>
        </div>
        <div className="spcard-b">
          <fieldset className="rst-fields">
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
