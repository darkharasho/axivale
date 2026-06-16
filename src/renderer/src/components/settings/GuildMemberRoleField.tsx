import { useEffect, useState, type ReactElement } from 'react'
import { Field } from '../panelui'
import { axi, errText, isOffline, type Overview } from '../panels/shared'
import { SearchSelect } from '../panels/SearchSelect'

/** Self-contained picker for the Discord role that marks a guild member. Reads/writes
 *  the `discordMemberRoleId` setting directly and loads roles from the connected
 *  server, so it needs no wiring through the Settings container. */
export default function GuildMemberRoleField(): ReactElement {
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([])
  const [value, setValue] = useState('')
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      setValue((await window.officer.getSetting('discordMemberRoleId')) ?? '')
      try {
        const ov = await axi<Overview>('discordOverview', true)
        setRoles((ov.roles ?? []).map((r) => ({ id: r.id, name: r.name })))
      } catch (e) {
        if (isOffline(e)) setOffline(true)
        else setError(errText(e))
      }
    })()
  }, [])

  async function pick(id: string): Promise<void> {
    setValue(id)
    await window.officer.setSetting('discordMemberRoleId', id)
  }

  return (
    <Field
      label="Guild member role"
      help={
        offline
          ? 'Connect a server above to choose a role.'
          : 'Members with this Discord role form the roster. Cross-referenced with linked GW2 accounts and the in-game guild to flag who hasn’t linked a key or has left.'
      }
    >
      <SearchSelect
        value={value}
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
        onChange={(id) => void pick(id)}
        placeholder={offline ? 'Server not connected' : 'No role set — uses linked roster'}
        searchPlaceholder="Find a role…"
      />
      {error && <div className="sstatus err">{error}</div>}
    </Field>
  )
}
