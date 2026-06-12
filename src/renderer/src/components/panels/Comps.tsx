import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  axi,
  ClassIcon,
  errText,
  isOffline,
  memberNames,
  Offline,
  textChannels,
  WEEK_FULL,
  ZapButton,
  type Overview
} from './shared'
import { ClassPicker } from './ClassPicker'

interface ClassSlot {
  name: string
  required: number
}

interface Preset {
  name: string
  config: unknown
}

interface Schedule {
  schedule_id: string
  name: string
  preset_name?: string
  post_days?: number[]
  post_time?: string
  timezone?: string
  signups?: Record<string, string[]>
}

interface CompConfig {
  channel_id?: string | null
  ping_role_id?: string | null
  post_days?: number[]
  post_time?: string
  timezone?: string
  active_preset?: string | null
}

/** Monday-first display labels; index i lines up with post_days value i. */
const MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Normalize a preset's config.classes into [{name,required}], tolerating
 * a missing classes key or a {className:count} shaped map.
 */
function readClasses(config: unknown): ClassSlot[] {
  if (!config || typeof config !== 'object') return []
  const classes = (config as Record<string, unknown>).classes
  if (Array.isArray(classes)) {
    return classes
      .map((c) => {
        if (!c || typeof c !== 'object') return null
        const o = c as Record<string, unknown>
        const name = String(o.name ?? '').trim()
        const required = Number(o.required)
        if (!name) return null
        return { name, required: Number.isFinite(required) ? required : 0 }
      })
      .filter((x): x is ClassSlot => x !== null)
  }
  if (classes && typeof classes === 'object') {
    return Object.entries(classes as Record<string, unknown>).map(([name, count]) => ({
      name,
      required: Number.isFinite(Number(count)) ? Number(count) : 0
    }))
  }
  return []
}

function totalSlots(classes: ClassSlot[]): number {
  return classes.reduce((sum, c) => sum + (c.required || 0), 0)
}

/** Box-score card for one preset, with optional signup fill bars. */
function PresetCard({
  preset,
  signups,
  onEdit,
  onDuplicate,
  onRemove
}: {
  preset: Preset
  signups: Record<string, string[]> | null
  onEdit: () => void
  onDuplicate: () => void
  onRemove: () => void
}): ReactElement {
  const classes = readClasses(preset.config)
  return (
    <div className="ccard">
      <div className="chead">
        <span className="cname">{preset.name}</span>
        <span className="cslots">{totalSlots(classes)} slots</span>
      </div>
      <div className="cbody">
        {classes.length === 0 ? (
          <div className="bnone">No classes defined.</div>
        ) : (
          classes.map((c) => {
            const got = signups ? (signups[c.name]?.length ?? 0) : null
            const pct =
              got !== null && c.required > 0
                ? Math.min(100, Math.round((got / c.required) * 100))
                : 0
            return (
              <div className="crow" key={c.name}>
                <ClassIcon name={c.name} size={18} />
                <span className="cqty">×{c.required}</span>
                <span className="cclass">{c.name}</span>
                {got !== null && (
                  <span className="csign">
                    <span className="csignnum">
                      {got}/{c.required} signed
                    </span>
                    <span className="cfill">
                      <span className="cfillbar" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
      <div className="cfoot">
        <button className="rowbtn" onClick={onEdit}>
          edit
        </button>
        <button className="rowbtn" onClick={onDuplicate}>
          duplicate
        </button>
        <ZapButton title={`Delete "${preset.name}"`} onConfirm={onRemove} />
      </div>
    </div>
  )
}

interface EditorState {
  original: string | null // existing preset name when editing, null when new
  name: string
  classes: ClassSlot[]
}

const EMPTY_EDITOR: EditorState = { original: null, name: '', classes: [] }

export default function Comps(): ReactElement {
  const [presets, setPresets] = useState<Preset[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [presetErr, setPresetErr] = useState('')
  const [schedErr, setSchedErr] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [busy, setBusy] = useState(false)

  // — Desk settings strip (guild-wide comp posting default) —
  const [ov, setOv] = useState<Overview | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cfg, setCfg] = useState<CompConfig>({})
  const [cfgStatus, setCfgStatus] = useState('')
  const [cfgErr, setCfgErr] = useState('')
  const [cfgBusy, setCfgBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, s, o, c] = await Promise.allSettled([
      axi<Preset[]>('listCompPresets'),
      axi<Schedule[]>('listCompSchedules'),
      axi<Overview>('discordOverview', true),
      axi<CompConfig>('compConfigGet')
    ])
    if (
      [p, s, o, c].some(
        (x) => x.status === 'rejected' && isOffline((x as PromiseRejectedResult).reason)
      )
    ) {
      setOffline(true)
      setLoaded(true)
      return
    }
    setOffline(false)
    if (p.status === 'fulfilled') {
      setPresets(p.value)
      setPresetErr('')
    } else setPresetErr(errText(p.reason))
    if (s.status === 'fulfilled') {
      setSchedules(s.value)
      setSchedErr('')
    } else setSchedErr(errText(s.reason))
    if (o.status === 'fulfilled') setOv(o.value)
    if (c.status === 'fulfilled') setCfg(c.value ?? {})
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function removePreset(name: string): Promise<void> {
    try {
      await axi('deleteCompPreset', name)
      if (editor?.original === name) setEditor(null)
      await load()
    } catch (e) {
      setPresetErr(errText(e))
    }
  }

  async function removeSchedule(id: string): Promise<void> {
    try {
      await axi('deleteCompSchedule', id)
      await load()
    } catch (e) {
      setSchedErr(errText(e))
    }
  }

  function openEditor(preset: Preset): void {
    setEditor({ original: preset.name, name: preset.name, classes: readClasses(preset.config) })
    setPresetErr('')
  }

  function duplicateEditor(preset: Preset): void {
    setEditor({
      original: null,
      name: `${preset.name} copy`,
      classes: readClasses(preset.config).map((c) => ({ ...c }))
    })
    setPresetErr('')
  }

  function newEditor(): void {
    setEditor({ ...EMPTY_EDITOR, classes: [] })
    setPresetErr('')
  }

  function patchClass(i: number, patch: Partial<ClassSlot>): void {
    setEditor((ed) =>
      ed
        ? { ...ed, classes: ed.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)) }
        : ed
    )
  }

  function addClass(): void {
    setEditor((ed) => (ed ? { ...ed, classes: [...ed.classes, { name: '', required: 1 }] } : ed))
  }

  function removeClass(i: number): void {
    setEditor((ed) => (ed ? { ...ed, classes: ed.classes.filter((_, j) => j !== i) } : ed))
  }

  async function filePreset(): Promise<void> {
    if (!editor) return
    setBusy(true)
    setPresetErr('')
    const name = editor.name.trim()
    const config = {
      classes: editor.classes
        .map((c) => ({ name: c.name.trim(), required: c.required }))
        .filter((c) => c.name)
    }
    try {
      await axi('putCompPreset', name, { name, config })
      setEditor(null)
      await load()
    } catch (e) {
      setPresetErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  function toggleCfgDay(i: number): void {
    setCfg((c) => {
      const days = c.post_days ?? []
      return {
        ...c,
        post_days: days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort((a, b) => a - b)
      }
    })
  }

  async function saveConfig(): Promise<void> {
    setCfgBusy(true)
    setCfgErr('')
    setCfgStatus('')
    try {
      await axi('compConfigPatch', {
        channel_id: cfg.channel_id || null,
        ping_role_id: cfg.ping_role_id || null,
        post_days: cfg.post_days ?? [],
        post_time: cfg.post_time ?? '',
        timezone: cfg.timezone ?? '',
        active_preset: cfg.active_preset || null
      })
      setCfgStatus('Saved')
    } catch (e) {
      setCfgErr(errText(e))
    } finally {
      setCfgBusy(false)
    }
  }

  if (offline) {
    return (
      <div className="settings">
        <Offline />
      </div>
    )
  }

  // Index signups by preset name (first schedule that references it wins).
  const signupsByPreset = new Map<string, Record<string, string[]>>()
  for (const s of schedules) {
    if (s.preset_name && s.signups && !signupsByPreset.has(s.preset_name)) {
      signupsByPreset.set(s.preset_name, s.signups)
    }
  }

  return (
    <div className="settings">
      <p className="shelp deck">
        Squad recipes on file — class quotas the bot fills against the roster.
      </p>

      <div className="deskset">
        <button
          type="button"
          className="deskset-head"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <span className="deskset-tog">{settingsOpen ? '▾' : '▸'}</span>
          <span className="deskset-lbl">Desk Settings</span>
        </button>
        {settingsOpen && (
          <div className="deskset-body">
            <label className="slabel">Posting channel</label>
            <select
              className="sselect"
              value={cfg.channel_id ?? ''}
              onChange={(e) => setCfg((c) => ({ ...c, channel_id: e.target.value }))}
            >
              <option value="">— none —</option>
              {textChannels(ov).map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <label className="slabel">Ping role</label>
            <select
              className="sselect"
              value={cfg.ping_role_id ?? ''}
              onChange={(e) => setCfg((c) => ({ ...c, ping_role_id: e.target.value }))}
            >
              <option value="">— none —</option>
              {(ov?.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label className="slabel">Default days</label>
            <div className="spills cfgdays">
              {MON_FIRST.map((d, i) => (
                <button
                  type="button"
                  className={`spill${(cfg.post_days ?? []).includes(i) ? ' on' : ''}`}
                  key={d}
                  title={WEEK_FULL[(i + 1) % 7]}
                  onClick={() => toggleCfgDay(i)}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="fgrid">
              <div>
                <label className="slabel">Default time</label>
                <input
                  className="sinput"
                  value={cfg.post_time ?? ''}
                  placeholder="HH:MM"
                  onChange={(e) => setCfg((c) => ({ ...c, post_time: e.target.value }))}
                />
              </div>
              <div>
                <label className="slabel">Timezone</label>
                <input
                  className="sinput"
                  value={cfg.timezone ?? ''}
                  placeholder="e.g. UTC"
                  onChange={(e) => setCfg((c) => ({ ...c, timezone: e.target.value }))}
                />
              </div>
            </div>
            <label className="slabel">Active preset</label>
            <select
              className="sselect"
              value={cfg.active_preset ?? ''}
              onChange={(e) => setCfg((c) => ({ ...c, active_preset: e.target.value }))}
            >
              <option value="">— none —</option>
              {presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="srow">
              <button
                className="sbtn"
                type="button"
                disabled={cfgBusy}
                onClick={() => void saveConfig()}
              >
                Save defaults
              </button>
            </div>
            {cfgStatus && <div className="sstatus ok">{cfgStatus}</div>}
            {cfgErr && <div className="sstatus err">{cfgErr}</div>}
          </div>
        )}
      </div>

      <div className="sgroup">
        <div className="cgrouphead">
          <h2>Composition Presets</h2>
          <button className="rowbtn" onClick={newEditor}>
            + new preset
          </button>
        </div>
        {presets.length === 0 ? (
          <div className="panel-empty">{loaded ? 'Nothing on file.' : 'Fetching presets…'}</div>
        ) : (
          <div className="cgrid">
            {presets.map((p) => (
              <PresetCard
                key={p.name}
                preset={p}
                signups={signupsByPreset.get(p.name) ?? null}
                onEdit={() => openEditor(p)}
                onDuplicate={() => duplicateEditor(p)}
                onRemove={() => void removePreset(p.name)}
              />
            ))}
          </div>
        )}

        {editor && (
          <div className="ceditor">
            <div className="cedithead">
              <span className="ceditlbl">
                {editor.original ? 'Amend Preset' : 'New Preset'}
              </span>
            </div>
            <label className="slabel">Preset name</label>
            <input
              className="sinput"
              value={editor.name}
              placeholder="e.g. tuesday-wvw"
              onChange={(e) => setEditor((ed) => (ed ? { ...ed, name: e.target.value } : ed))}
            />
            <label className="slabel">Classes</label>
            {editor.classes.length === 0 && (
              <div className="bnone editnone">No classes yet — add one below.</div>
            )}
            {editor.classes.map((c, i) => (
              <div className="ceditrow" key={i}>
                <div className="cnameinput">
                  <ClassPicker
                    value={c.name}
                    onChange={(v) => patchClass(i, { name: v })}
                    placeholder="class or spec"
                  />
                </div>
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() => patchClass(i, { required: Math.max(0, c.required - 1) })}
                  >
                    −
                  </button>
                  <span className="stepval">{c.required}</span>
                  <button type="button" onClick={() => patchClass(i, { required: c.required + 1 })}>
                    +
                  </button>
                </div>
                <button className="rowbtn" type="button" onClick={() => removeClass(i)}>
                  remove
                </button>
              </div>
            ))}
            <div className="srow editactions">
              <button className="rowbtn" type="button" onClick={addClass}>
                + add class
              </button>
              <button
                className="sbtn"
                type="button"
                disabled={busy || !editor.name.trim()}
                onClick={() => void filePreset()}
              >
                File preset
              </button>
              <button className="sbtn out" type="button" onClick={() => setEditor(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {presetErr && <div className="sstatus err">{presetErr}</div>}
      </div>

      <div className="sgroup">
        <h2>Posting Schedule</h2>
        {schedules.length === 0 ? (
          <div className="panel-empty">{loaded ? 'No standing schedules.' : 'Fetching schedules…'}</div>
        ) : (
          <div className="scards">
            {schedules.map((s) => {
              const days = s.post_days ?? []
              const signups = s.signups ?? {}
              const signupRows = Object.entries(signups).filter(([, m]) => m && m.length)
              const names = memberNames(ov)
              const nameOf = (id: string): string => names.get(String(id)) ?? id
              return (
                <div className="scard" key={s.schedule_id}>
                  <div className="shead">
                    <span className="sname">{s.name}</span>
                    <span className="spreset">preset · {s.preset_name ?? '—'}</span>
                    <ZapButton
                      title={`Delete "${s.name}"`}
                      onConfirm={() => void removeSchedule(s.schedule_id)}
                    />
                  </div>
                  <div className="spills">
                    {MON_FIRST.map((d, i) => (
                      <span
                        className={`spill${days.includes(i) ? ' on' : ''}`}
                        key={d}
                        title={WEEK_FULL[(i + 1) % 7]}
                      >
                        {d}
                      </span>
                    ))}
                    <span className="stime">
                      {s.post_time ?? '—'}
                      {s.timezone ? ` ${s.timezone}` : ''}
                    </span>
                  </div>
                  {signupRows.length > 0 && (
                    <div className="ssignups">
                      {signupRows.map(([cls, members]) => {
                        const shown = members.slice(0, 4)
                        const extra = members.length - shown.length
                        return (
                          <div className="ssignrow" key={cls}>
                            <ClassIcon name={cls} size={16} />
                            <span className="ssignclass">{cls}</span>
                            <span className="ssignnames">
                              {shown.map(nameOf).join(', ')}
                              {extra > 0 ? ` +${extra} more` : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {schedErr && <div className="sstatus err">{schedErr}</div>}
        <p className="shelp">
          Schedules are read-only here — edit them with <code>/comp</code> in Discord, or ask
          AxiVale on the Dispatches desk.
        </p>
      </div>
    </div>
  )
}
