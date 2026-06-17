import { useMemo, useState, type ReactElement, type KeyboardEvent } from 'react'
import type { RendererReconciledMember } from '../../../../preload/index.d'
import { Offline } from './shared'
import { SearchSelect } from './SearchSelect'
import { STATUS_META, linkLabel, type RosterController, type RosterDraft } from './useRoster'

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

/** Strip digits/punctuation, drop 1-char tokens — ".harasho" -> "harasho". */
function cleanName(s: string): string {
  return s
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .join(' ')
    .trim()
}
const accountLocal = (a: string): string => a.split('.')[0] ?? a

/** The set of names the AI can resolve to this identity: annotations, the Discord
 *  display name/username (plus a cleaned variant), and each GW2 account's name
 *  without its .#### discriminator. */
function resolvePreview(draft: RosterDraft, m: RendererReconciledMember): string {
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (s?: string): void => {
    const t = s?.trim()
    if (!t) return
    const k = t.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      terms.push(t)
    }
  }
  add(draft.nickname)
  draft.aliases.forEach(add)
  add(m.displayName)
  add(m.discordName)
  add(cleanName(m.displayName ?? ''))
  add(cleanName(m.discordName ?? ''))
  m.accounts.forEach((a) => add(accountLocal(a.account_name)))

  if (!terms.length || m.accounts.length === 0) return ''
  return `${terms.join(', ')} → ${m.accounts.map((a) => a.account_name).join(', ')}`
}

/** Discord-link card: pick a Discord user for an unlinked GW2 account, or unlink a
 *  manual link. Auto links (from AxiTools) are shown read-only. */
function LinkCard({ ctl, m }: { ctl: RosterController; m: RendererReconciledMember }): ReactElement | null {
  // Built once per Discord list, not on every keystroke in the annotation fields:
  // re-mapping/sorting the whole guild each render made typing (aliases especially)
  // stutter on large rosters.
  const options = useMemo(
    () =>
      ctl.discordMembers
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
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ctl.discordMembers]
  )
  if (!m.accountName) return null // only GW2-account rows are linkable here
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
  onUnlink,
  onSetMain
}: {
  acc: RendererReconciledMember['accounts'][number]
  onUnlink: () => void
  onSetMain?: () => void
}): ReactElement {
  return (
    <div className={`spcard${acc.main ? ' rst-acct-main' : ''}`}>
      <div className="spcard-h">
        <span className="spcard-t rst-acct">{acc.account_name}</span>
        {acc.main ? (
          <span className="rst-main-badge">Main</span>
        ) : (
          onSetMain && (
            <button className="rst-setmain" onClick={onSetMain}>
              Set main
            </button>
          )
        )}
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
              {linkLabel(current) === 'mix'
                ? 'mixed links'
                : linkLabel(current) === 'manual'
                  ? 'manual link'
                  : STATUS_META[current.status].sub}
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
        <AccountCard
          key={acc.account_name}
          acc={acc}
          onUnlink={() => void ctl.unlink(acc.account_name)}
          onSetMain={
            current.accounts.length > 1 && !acc.main
              ? () => void ctl.setMain(acc.account_name)
              : undefined
          }
        />
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
