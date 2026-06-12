import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  axi,
  ClassIcon,
  errText,
  isOffline,
  Offline,
  WEEK_FULL,
  ZapButton
} from './shared'

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

  const load = useCallback(async () => {
    const [p, s] = await Promise.allSettled([
      axi<Preset[]>('listCompPresets'),
      axi<Schedule[]>('listCompSchedules')
    ])
    if (
      (p.status === 'rejected' && isOffline(p.reason)) ||
      (s.status === 'rejected' && isOffline(s.reason))
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
                <input
                  className="sinput cnameinput"
                  value={c.name}
                  placeholder="class or spec"
                  onChange={(e) => patchClass(i, { name: e.target.value })}
                />
                <ClassIcon name={c.name} size={20} />
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
                              {shown.join(', ')}
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
