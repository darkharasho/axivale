import { useCallback, useEffect, useState, type ReactElement } from 'react'
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

export default function Roster(): ReactElement {
  const [members, setMembers] = useState<Member[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
            <b>{members.length}</b> {members.length === 1 ? 'member' : 'members'} linked
          </div>
          <button className="sbtn out" disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {members.length === 0 ? (
          <div className="panel-empty">
            {loaded ? 'No members have linked their accounts yet.' : 'Fetching the roster…'}
          </div>
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
              {members.map((m) => (
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
