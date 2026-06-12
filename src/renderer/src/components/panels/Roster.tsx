import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { axi, errText, isOffline, Offline } from './shared'

interface LinkedAccount {
  account_name: string
  characters: string[]
  gw2_guild_ids: string[]
  guild_labels: Record<string, string>
}

interface Member {
  member_id: string
  member_name?: string
  accounts: LinkedAccount[]
  preferred_role_id?: string
}

function guildList(m: Member): string {
  const labels = new Set<string>()
  for (const a of m.accounts) {
    for (const label of Object.values(a.guild_labels ?? {})) labels.add(label)
  }
  return labels.size > 0 ? [...labels].join(', ') : '—'
}

function characterCount(m: Member): number {
  return m.accounts.reduce((n, a) => n + (a.characters?.length ?? 0), 0)
}

function memberGuildLabels(m: Member): Set<string> {
  const labels = new Set<string>()
  for (const a of m.accounts) {
    for (const label of Object.values(a.guild_labels ?? {})) labels.add(label)
  }
  return labels
}

/** All text a search should match against, lowercased. */
function searchHaystack(m: Member): string {
  const parts: string[] = [m.member_name ?? '', m.member_id]
  for (const a of m.accounts) {
    parts.push(a.account_name, ...(a.characters ?? []))
  }
  return parts.join(' ').toLowerCase()
}

export default function Roster(): ReactElement {
  const [members, setMembers] = useState<Member[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [guildFilter, setGuildFilter] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setMembers(await axi<Member[]>('membersLinked'))
      setOffline(false)
      setError('')
    } catch (e) {
      if (isOffline(e)) setOffline(true)
      else setError(errText(e))
    } finally {
      setLoaded(true)
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Guild options for the filter, union across all members, alphabetized.
  const guildOptions = useMemo(() => {
    const all = new Set<string>()
    for (const m of members) for (const l of memberGuildLabels(m)) all.add(l)
    return [...all].sort((a, b) => a.localeCompare(b))
  }, [members])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) => {
      if (q && !searchHaystack(m).includes(q)) return false
      if (guildFilter && !memberGuildLabels(m).has(guildFilter)) return false
      return true
    })
  }, [members, query, guildFilter])

  if (offline) {
    return (
      <div className="settings">
        <Offline />
      </div>
    )
  }

  return (
    <div className="settings">
      <div className="sgroup">
        <h2>Linked Membership</h2>
        <div className="srow">
          <div className="countline">
            <b>{filtered.length}</b>
            {query || guildFilter ? ` of ${members.length}` : ''}{' '}
            {members.length === 1 ? 'member' : 'members'}
            {query || guildFilter ? ' shown' : ' linked'}
          </div>
          <button className="sbtn out" disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {members.length > 0 && (
          <div className="roster-filters">
            <input
              className="sinput"
              type="text"
              value={query}
              placeholder="Search member, account, or character…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="sselect"
              value={guildFilter}
              onChange={(e) => setGuildFilter(e.target.value)}
            >
              <option value="">All guilds</option>
              {guildOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            {(query || guildFilter) && (
              <button
                className="sbtn out"
                onClick={() => {
                  setQuery('')
                  setGuildFilter('')
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {members.length === 0 ? (
          <div className="panel-empty">
            {loaded ? 'No members have linked their accounts yet.' : 'Fetching the roster…'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel-empty">No members match the current filters.</div>
        ) : (
          <table className="roster-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Accounts</th>
                <th>Guilds</th>
                <th>Characters</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.member_id}>
                  <td className="nm2 mono">{m.member_name || m.member_id}</td>
                  <td className="mono">
                    {m.accounts.length > 0 ? m.accounts.map((a) => a.account_name).join(', ') : '—'}
                  </td>
                  <td className="mono">{guildList(m)}</td>
                  <td className="mono">{characterCount(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <div className="sstatus err">{error}</div>}
      </div>
    </div>
  )
}
