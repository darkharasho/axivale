import { useEffect, useState, type ReactElement } from 'react'
import { Field } from '../panelui'
import { axi, errText, isOffline, type Overview } from '../panels/shared'
import { SearchSelect } from '../panels/SearchSelect'

const SETTING = 'discordMemberRoleByGuild'

async function readMap(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await window.officer.getSetting(SETTING)) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/** Self-contained picker for the Discord role that marks a guild member. Stored
 *  per server (keyed by guild id) since each connected server has its own roles;
 *  remount via `key={guildId}` reloads roles + the saved value when the active
 *  server changes. */
export default function GuildMemberRoleField({
  guildId
}: {
  guildId: string | null
}): ReactElement {
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([])
  const [value, setValue] = useState('')
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const map = await readMap()
      setValue((guildId && map[guildId]) || '')
      if (!guildId) return
      try {
        const ov = await axi<Overview>('discordOverview', true)
        setRoles((ov.roles ?? []).map((r) => ({ id: r.id, name: r.name })))
      } catch (e) {
        if (isOffline(e)) setOffline(true)
        else setError(errText(e))
      }
    })()
  }, [guildId])

  async function pick(id: string): Promise<void> {
    setValue(id)
    if (!guildId) return
    const map = await readMap()
    if (id) map[guildId] = id
    else delete map[guildId]
    await window.officer.setSetting(SETTING, JSON.stringify(map))
  }

  return (
    <Field
      label="Guild member role"
      help={
        guildId
          ? 'Members with this Discord role form the roster for this server. Cross-referenced with linked GW2 accounts and the in-game guild to flag who hasn’t linked a key or has left. Set per server.'
          : 'Connect a server above to choose a role.'
      }
    >
      <SearchSelect
        value={value}
        options={roles.map((r) => ({ value: r.id, label: r.name }))}
        onChange={(id) => void pick(id)}
        placeholder={guildId ? 'No role set — uses linked roster' : 'Server not connected'}
        searchPlaceholder="Find a role…"
      />
      {offline && <div className="shelp">Server not connected.</div>}
      {error && <div className="sstatus err">{error}</div>}
    </Field>
  )
}
