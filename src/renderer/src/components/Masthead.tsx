import { useEffect, useRef, useState, type ReactElement } from 'react'

export type Section = 'dispatches' | 'operations' | 'roster' | 'skills' | 'meta' | 'settings'

/** 0 has no Roman numeral, so keep it literal; otherwise standard Roman. */
function toRoman(n: number): string {
  if (n <= 0) return '0'
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ]
  let out = ''
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v)
  return out
}

/** Cheeky newspaper folio from the app's semver: major→Vol. (Roman), minor→No.,
 *  patch→Ed. e.g. 0.3.2 → "Vol. 0 · No. 3 · Ed. 2". */
export function versionFolio(version: string): string {
  const p = version.split('.')
  const maj = parseInt(p[0] ?? '', 10) || 0
  const min = parseInt(p[1] ?? '', 10) || 0
  const pat = parseInt(p[2] ?? '', 10) || 0
  return `Vol. ${toRoman(maj)} · No. ${min} · Ed. ${pat}`
}

export interface MastheadProps {
  version: string
  axiConnected: boolean
  gw2AccountName: string | null
  guildName: string | null
  guildTag: string | null
  memberCount: number | null
  claudeTokenSaved: boolean
  section: Section
  onSection: (s: Section) => void
  onSwitched: () => void
}

interface KeyLabel {
  label: string
  active: boolean
}

/**
 * Quick-swap dropdown on a masthead ear: lists the saved keys for a service
 * and switches the active one in place, without opening Settings.
 */
function EarSwitcher({
  service,
  display,
  align = 'left',
  onSwitched
}: {
  service: 'gw2' | 'axivale'
  display: string
  align?: 'left' | 'right'
  onSwitched: () => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState<KeyLabel[]>([])
  const ref = useRef<HTMLSpanElement>(null)

  async function toggle(): Promise<void> {
    if (open) {
      setOpen(false)
      return
    }
    setKeys(await window.officer.listKeys(service))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function pick(label: string): Promise<void> {
    setOpen(false)
    await window.officer.setActiveKey(service, label)
    onSwitched()
  }

  return (
    <span className={`earsw${open ? ' open' : ''}`} ref={ref}>
      <button className="earsw-btn" onClick={() => void toggle()}>
        {display}
        <span className="earsw-caret">▾</span>
      </button>
      {open && (
        <div className={`earsw-menu ${align}`}>
          {keys.length === 0 ? (
            <div className="earsw-empty">no saved keys</div>
          ) : (
            keys.map((k) => (
              <button
                key={k.label}
                className={`earsw-opt${k.active ? ' sel' : ''}`}
                onClick={() => void pick(k.label)}
              >
                {k.label}
                {k.active && <span className="dot">●</span>}
              </button>
            ))
          )}
        </div>
      )}
    </span>
  )
}

interface Gw2Guild {
  id: string
  name: string
  tag: string
  leader: boolean
}

/**
 * Quick-switch dropdown for the active GW2 guild. Shows the saved guild name
 * when closed; on open it validates the active GW2 key to list the user's
 * guilds and switches the `gw2GuildId` setting in place — no Settings detour.
 */
export function Gw2GuildSwitcher({ onSwitched }: { onSwitched: () => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const [display, setDisplay] = useState<string>('no guild')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [guilds, setGuilds] = useState<Gw2Guild[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  async function refresh(): Promise<void> {
    const name = await window.officer.getSetting('gw2GuildName')
    setDisplay(name ?? 'no guild')
    setCurrentId(await window.officer.getSetting('gw2GuildId'))
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function toggle(): Promise<void> {
    if (open) {
      setOpen(false)
      return
    }
    setGuilds(null)
    setError(null)
    setOpen(true)
    const res = await window.officer.validateGw2Key()
    if (res.ok && res.info) {
      setGuilds((res.info as { guilds: Gw2Guild[] }).guilds ?? [])
    } else {
      setError(res.error ?? 'no GW2 key')
    }
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function pick(g: Gw2Guild): Promise<void> {
    const text = g.name + (g.tag ? ` [${g.tag}]` : '')
    setOpen(false)
    await window.officer.setSetting('gw2GuildId', g.id)
    await window.officer.setSetting('gw2GuildName', text)
    setDisplay(text)
    setCurrentId(g.id)
    onSwitched()
  }

  return (
    <span className={`earsw${open ? ' open' : ''}`} ref={ref}>
      <button className="earsw-btn" onClick={() => void toggle()}>
        {display}
        <span className="earsw-caret">▾</span>
      </button>
      {open && (
        <div className="earsw-menu left">
          {error ? (
            <div className="earsw-empty">{error}</div>
          ) : guilds === null ? (
            <div className="earsw-empty">loading…</div>
          ) : guilds.length === 0 ? (
            <div className="earsw-empty">no guilds</div>
          ) : (
            guilds.map((g) => (
              <button
                key={g.id}
                className={`earsw-opt${g.id === currentId ? ' sel' : ''}`}
                onClick={() => void pick(g)}
              >
                {g.name}
                {g.tag ? ` [${g.tag}]` : ''}
                {g.leader ? ' ★' : ''}
                {g.id === currentId && <span className="dot">●</span>}
              </button>
            ))
          )}
        </div>
      )}
    </span>
  )
}

export default function Masthead(props: MastheadProps): ReactElement {
  const {
    version,
    axiConnected,
    gw2AccountName,
    guildName,
    guildTag,
    memberCount,
    claudeTokenSaved,
    section,
    onSection,
    onSwitched
  } = props

  const guildDetail = guildName
    ? `${guildTag ? `[${guildTag}]` : ''}${
        memberCount != null ? `${guildTag ? ' · ' : ''}${memberCount} members` : ''
      }`
    : 'no guild'

  return (
    <div className="masthead">
      <div className="mtop">
        <span>{versionFolio(version)}</span>
        <span className="r">Final Edition · Free to Members</span>
        <span className="winctl">
          <button title="Minimize" onClick={() => window.officer.windowControl('minimize')}>
            —
          </button>
          <button
            title="Maximize"
            onClick={() => window.officer.windowControl('maximize-toggle')}
          >
            □
          </button>
          <button
            className="close"
            title="Close"
            onClick={() => window.officer.windowControl('close')}
          >
            ✕
          </button>
        </span>
      </div>
      <div className="mmain">
        <div className="ear">
          <div>
            <b>AxiTools</b>{' '}
            {axiConnected ? (
              <span className="lit">● connected</span>
            ) : (
              <span className="off-air">● offline</span>
            )}
          </div>
          <div>
            <b>GW2 API</b>{' '}
            <EarSwitcher
              service="gw2"
              display={gw2AccountName ?? 'no key'}
              align="left"
              onSwitched={onSwitched}
            />
          </div>
          <div>
            <b>GW2 Guild</b> <Gw2GuildSwitcher onSwitched={onSwitched} />
          </div>
        </div>
        <div className="title">
          AxiVale<em>.</em>
        </div>
        <div className="ear right">
          <div>
            <EarSwitcher
              service="axivale"
              display={guildName ?? 'Guild'}
              align="right"
              onSwitched={onSwitched}
            />{' '}
            {guildDetail}
          </div>
          <div>
            <b>Claude</b> {claudeTokenSaved ? 'token saved' : 'system login'}
          </div>
        </div>
      </div>
      <div className="mnav">
        {(
          [
            ['01', 'dispatches', 'Dispatches'],
            ['02', 'operations', 'Operations'],
            ['03', 'roster', 'Roster'],
            ['04', 'skills', 'Skills'],
            ['05', 'meta', 'Sources'],
            ['06', 'settings', 'Settings']
          ] as Array<[string, Section, string]>
        ).map(([no, key, label]) => (
          <button key={key} className={section === key ? 'on' : ''} onClick={() => onSection(key)}>
            <span className="no">{no}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
