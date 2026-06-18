import type { ReactElement } from 'react'
import type { ToolCall } from '../state'
import RichDisplay from './rich/RichDisplay'

// Friendly two-part labels for known tools. Keep dumb and total.
const LABELS: Record<string, string> = {
  axitools_builds_list: 'BUILDS / LIST',
  axitools_builds_create: 'BUILDS / CREATE',
  axitools_builds_update: 'BUILDS / UPDATE',
  axitools_builds_delete: 'BUILDS / DELETE',
  axitools_comp_presets_list: 'COMPS / LIST PRESETS',
  axitools_comp_presets_save: 'COMPS / SAVE PRESET',
  axitools_comp_presets_delete: 'COMPS / DELETE PRESET',
  axitools_comp_schedules_list: 'COMPS / LIST SCHEDULES',
  axitools_comp_schedules_save: 'COMPS / SAVE SCHEDULE',
  discord_overview: 'DISCORD / OVERVIEW',
  discord_messages: 'DISCORD / MESSAGES',
  discord_action: 'DISCORD / ACTION',
  gw2_api: 'GW2 / API',
  gw2_guild_log: 'GW2 / GUILD LOG',
  axitools_audit: 'AXITOOLS / AUDIT',
  axitools_rss: 'AXITOOLS / RSS',
  axitools_streams: 'AXITOOLS / STREAMS',
  axitools_alliance: 'AXITOOLS / ALLIANCE',
  axitools_guild_roles: 'AXITOOLS / GUILD ROLES',
  axitools_config: 'AXITOOLS / CONFIG',
  axitools_members: 'AXITOOLS / MEMBERS',
  axitools_key_holders: 'AXITOOLS / KEY CHECK',
  gw2_guild_members: 'GW2 / GUILD MEMBERS',
  gw2_account_info: 'GW2 / ACCOUNT INFO'
}

export function couponLabel(name: string): string {
  if (LABELS[name]) return LABELS[name]
  let rest = name
  let prefix = ''
  if (name.startsWith('axitools_')) {
    prefix = 'AXITOOLS'
    rest = name.slice('axitools_'.length)
  } else if (name.startsWith('gw2_')) {
    prefix = 'GW2'
    rest = name.slice('gw2_'.length)
  }
  const words = rest.replace(/[_-]+/g, ' ').trim().toUpperCase()
  if (prefix) {
    const parts = words.split(' ')
    const head = parts.shift() ?? ''
    const tail = parts.join(' ')
    return tail ? `${prefix} / ${head} ${tail}`.trim() : `${prefix} / ${head}`
  }
  return words || name.toUpperCase()
}

function isObjectArray(v: unknown): v is Record<string, unknown>[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((e) => e !== null && typeof e === 'object' && !Array.isArray(e))
  )
}

/** Render a value as plain newspaper copy — no braces, no quotes. */
export function humanValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return v.map(humanValue).join(', ')
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '—'
    return entries.map(([k, val]) => `${prettyKey(k)} ${humanValue(val)}`).join(', ')
  }
  return String(v)
}

export function prettyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
}

/** One-line summary of a tool's input: `preset tuesday-wvw · add Riversong, Tessa`. */
export function humanInput(input: Record<string, unknown>, max = 110): string {
  const s = Object.entries(input)
    .map(([k, v]) => `${prettyKey(k)} ${humanValue(v)}`)
    .join(' · ')
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function renderBody(tool: ToolCall): ReactElement {
  const text = tool.resultText ?? ''
  if (tool.isError) {
    return <div className="err">{text || 'The action failed.'}</div>
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (isObjectArray(parsed)) {
    const rows = parsed
    const keys: string[] = []
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        if (!keys.includes(k)) keys.push(k)
      }
    }
    const cols = keys.slice(0, 5)
    const shown = rows.slice(0, 12)
    const extra = rows.length - shown.length
    return (
      <>
        <table>
          <thead>
            <tr>
              {cols.map((k) => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i}>
                {cols.map((k, j) => (
                  <td key={k} className={j === 0 ? 'nm2' : undefined}>
                    {cell(row[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {extra > 0 && <div className="more">+{extra} more</div>}
      </>
    )
  }
  // Plain object → classified-ad manifest rows, not JSON.
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== undefined) {
    const entries = Object.entries(parsed as Record<string, unknown>)
    return (
      <div className="manifest">
        {entries.map(([k, v]) => (
          <div className="kv" key={k}>
            <span className="k">{prettyKey(k)}</span>
            <span className="v">{humanValue(v)}</span>
          </div>
        ))}
      </div>
    )
  }
  // Array of scalars → reads as a list of names/ids.
  if (Array.isArray(parsed)) {
    return <div className="copy">{parsed.length === 0 ? 'Nothing on file.' : humanValue(parsed)}</div>
  }
  if (parsed !== undefined) {
    return <div className="copy">{String(parsed)}</div>
  }
  return <div className="copy">{text}</div>
}

export function renderCouponBody(tool: ToolCall): ReactElement {
  if (tool.display && !tool.isError) {
    const rich = RichDisplay({ display: tool.display })
    if (rich !== null) return rich
  }
  return renderBody(tool)
}

export default function ToolCoupon({ tool }: { tool: ToolCall }): ReactElement {
  const working = tool.resultText === undefined && !tool.isError
  let status: ReactElement
  if (working) {
    status = <span className="st work">… working</span>
  } else if (tool.isError) {
    status = <span className="st fail">✗ failed</span>
  } else {
    status = <span className="st">✓ filed</span>
  }
  const hasInput = tool.input && Object.keys(tool.input).length > 0
  return (
    <div className={`tool${working ? ' work' : ''}`}>
      <div className="th">
        <span className="nm">{couponLabel(tool.name)}</span>
        {status}
      </div>
      <div className="tb">
        {hasInput && <div className="tin">{humanInput(tool.input)}</div>}
        {!working && renderCouponBody(tool)}
      </div>
    </div>
  )
}
