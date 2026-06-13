import { useState, type ReactElement } from 'react'
import type { DisplayPayload } from '../../state'

type TableSpec = Extract<DisplayPayload, { kind: 'table' }>['data']

function cell(v: string | number | undefined): string {
  return v === undefined || v === null || v === '' ? '—' : String(v)
}

/** Sortable explicit-columns table — the box-score block of the gazette. */
export default function RichTable({ spec }: { spec: TableSpec }): ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [dir, setDir] = useState<1 | -1>(1)

  const onSort = (key: string): void => {
    if (sortKey === key) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setDir(1)
    }
  }

  const rows = sortKey
    ? [...spec.rows].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir
      })
    : spec.rows

  return (
    <div className="rich richtable">
      {spec.title && <div className="rich-title">{spec.title}</div>}
      <table>
        <thead>
          <tr>
            {spec.columns.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)}>
                {c.label}
                {sortKey === c.key && <span className="arr">{dir === 1 ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {spec.columns.map((c, j) => (
                <td key={c.key} className={j === 0 ? 'nm2' : undefined}>
                  {cell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
