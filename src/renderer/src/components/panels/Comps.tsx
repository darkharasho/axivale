import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { axi, errText, isOffline, Offline, WEEK_SHORT, ZapButton } from './shared'

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
}

/** "5 classes · 25 slots" from config.classes, when present. */
function presetSummary(config: unknown): string {
  if (config && typeof config === 'object') {
    const classes = (config as Record<string, unknown>).classes
    if (Array.isArray(classes)) {
      const slots = classes.reduce((sum: number, c) => {
        const req = c && typeof c === 'object' ? Number((c as Record<string, unknown>).required) : NaN
        return sum + (Number.isFinite(req) ? req : 0)
      }, 0)
      return `${classes.length} ${classes.length === 1 ? 'class' : 'classes'} · ${slots} ${slots === 1 ? 'slot' : 'slots'}`
    }
  }
  return '—'
}

function scheduleDays(days: number[] | undefined): string {
  if (!days || days.length === 0) return '—'
  return days.map((d) => WEEK_SHORT[d] ?? String(d)).join('/')
}

export default function Comps(): ReactElement {
  const [presets, setPresets] = useState<Preset[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [presetErr, setPresetErr] = useState('')
  const [schedErr, setSchedErr] = useState('')

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
      await load()
    } catch (e) {
      setPresetErr(errText(e))
    }
  }

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
        <h2>Composition Presets</h2>
        <p className="shelp">Squad recipes on file — class quotas the bot fills against the roster.</p>
        {presets.length === 0 ? (
          <div className="panel-empty">{loaded ? 'Nothing on file.' : 'Fetching presets…'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Composition</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.name}>
                  <td className="nm2">{p.name}</td>
                  <td>{presetSummary(p.config)}</td>
                  <td className="act">
                    <ZapButton title={`Delete "${p.name}"`} onConfirm={() => void removePreset(p.name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {presetErr && <div className="sstatus err">{presetErr}</div>}
      </div>

      <div className="sgroup">
        <h2>Posting Schedule</h2>
        {schedules.length === 0 ? (
          <div className="panel-empty">{loaded ? 'No standing schedules.' : 'Fetching schedules…'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Preset</th>
                <th>Days</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.schedule_id}>
                  <td className="nm2">{s.name}</td>
                  <td>{s.preset_name ?? '—'}</td>
                  <td className="mono">{scheduleDays(s.post_days)}</td>
                  <td className="mono">
                    {s.post_time ?? '—'}
                    {s.timezone ? ` ${s.timezone}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {schedErr && <div className="sstatus err">{schedErr}</div>}
        <p className="shelp">
          Schedules are read-only here — edit them with <code>/comp</code> in Discord, or ask AxiVale
          on the Dispatches desk.
        </p>
      </div>
    </div>
  )
}
