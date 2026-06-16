import type { ReactElement } from 'react'
import { rosterKey, STATUS_META, type RosterController, type RosterFilter } from './useRoster'

const FILTERS: Array<{ key: RosterFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'no-key', label: 'No key' },
  { key: 'mismatch', label: 'Mismatch' },
  { key: 'annotated', label: 'Noted' }
]

/** Left-rail master list for the Roster tab: search, status filter chips, and the
 *  reconciled member list (replaces Editions on this section). */
export default function RosterNav({ ctl }: { ctl: RosterController }): ReactElement {
  const { members, filtered, selectedKey, query, setQuery, filter, setFilter, busy, refresh } = ctl
  return (
    <nav className="rail left sk2-rail">
      <div className="sk2-rail-h">
        <span className="sk2-kick">Roster · {members.length}</span>
        <button className="sk2-new" disabled={busy} onClick={() => void refresh()}>
          {busy ? '…' : 'Refresh'}
        </button>
      </div>
      <input
        className="sk2-search"
        placeholder="Search name, account, character…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="rst-fchips">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`rst-fchip${filter === f.key ? ' on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className="sk2-items">
        {filtered.map((m) => {
          const key = rosterKey(m)
          const meta = STATUS_META[m.status]
          return (
            <li
              key={key}
              className={`sk2-item${key === selectedKey ? ' on' : ''}`}
              onClick={() => ctl.select(m)}
            >
              <span className={`led ${meta.led}`} />
              <div className="sk2-item-txt">
                <div className="sk2-item-nm">{m.label}</div>
                <div className="sk2-item-wh">
                  {m.accounts[0]?.account_name ? `${m.accounts[0].account_name} · ` : ''}
                  {meta.sub}
                </div>
              </div>
            </li>
          )
        })}
        {filtered.length === 0 && (
          <li className="sk2-empty">{members.length === 0 ? 'No members.' : 'No matches.'}</li>
        )}
      </ul>
    </nav>
  )
}
