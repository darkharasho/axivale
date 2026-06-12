import type { ReactElement } from 'react'
import type { ToolCall } from '../state'

// Friendly two-part labels for known tools. Keep dumb and total.
const LABELS: Record<string, string> = {
  axitools_comp_presets_save: 'COMPS / SAVE PRESET',
  axitools_comp_preset_edit: 'COMPS / EDIT PRESET',
  axitools_comps_list: 'COMPS / LIST',
  axitools_builds_list: 'BUILDS / LIST',
  axitools_builds_get: 'BUILDS / GET',
  axitools_builds_save: 'BUILDS / SAVE',
  axitools_config_get: 'CONFIG / GET',
  axitools_config_set: 'CONFIG / SET',
  gw2_guild_log: 'GW2 / GUILD LOG',
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

function compactInput(input: Record<string, unknown>): string {
  const s = JSON.stringify(input)
  return s.length > 110 ? s.slice(0, 109) + '…' : s
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function renderBody(tool: ToolCall): ReactElement {
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
  if (parsed !== undefined) {
    return <pre>{JSON.stringify(parsed, null, 2)}</pre>
  }
  return <pre>{text}</pre>
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
        {hasInput && <div className="tin">{compactInput(tool.input)}</div>}
        {!working && renderBody(tool)}
      </div>
    </div>
  )
}
