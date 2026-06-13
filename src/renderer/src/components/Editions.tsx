import { useMemo, useState, type ReactElement } from 'react'
import type { Turn } from '../state'
import { splitHeadline, stripMarkdown } from './headline'

export interface EditionItem {
  id: string
  title: string | null
  updatedAt: string
  turns: Turn[]
  dispatchCount: number
  fresh: boolean
}

interface EditionsProps {
  items: EditionItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/** Auto headline: first done AI turn, else first user line, else fallback. */
function autoHeadline(item: EditionItem): string {
  if (item.title && item.title.trim()) return item.title
  const aiTurn = item.turns.find((t) => t.done && t.agentText.trim())
  if (aiTurn) {
    const { headline } = splitHeadline(stripMarkdown(aiTurn.agentText))
    if (headline.trim()) return headline
  }
  const userTurn = item.turns.find((t) => t.userText.trim())
  if (userTurn) return userTurn.userText.split('\n')[0].trim()
  return 'Untitled dispatch'
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function metaLine(item: EditionItem): string {
  const d = new Date(item.updatedAt)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const n = item.dispatchCount
  return `${date} · ${time} · ${n} ${n === 1 ? 'dispatch' : 'dispatches'}`
}

function Row({
  item,
  active,
  onSelect,
  onRename,
  onDelete
}: {
  item: EditionItem
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const headline = autoHeadline(item)

  function startEdit(e: React.MouseEvent): void {
    e.stopPropagation()
    setDraft(item.title ?? headline)
    setEditing(true)
  }

  function commit(): void {
    const trimmed = draft.trim()
    if (trimmed) onRename(item.id, trimmed)
    setEditing(false)
  }

  function remove(e: React.MouseEvent): void {
    e.stopPropagation()
    if (window.confirm('Delete this edition? The transcript will be lost.')) onDelete(item.id)
  }

  return (
    <div
      className={`edition${active ? ' active' : ''}${item.fresh ? ' fresh' : ''}`}
      onClick={() => onSelect(item.id)}
      role="button"
    >
      {item.fresh && <div className="kick">✦ Hot off the press</div>}
      {editing ? (
        <input
          className="ed-rename"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
        />
      ) : (
        <div className="ed-headline">{headline}</div>
      )}
      <div className="ed-meta">{metaLine(item)}</div>
      <div className="ed-acts">
        <button title="Rename" onClick={startEdit}>
          ✎
        </button>
        <button title="Delete" onClick={remove}>
          ✕
        </button>
      </div>
    </div>
  )
}

export default function Editions({
  items,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete
}: EditionsProps): ReactElement {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => autoHeadline(it).toLowerCase().includes(q))
  }, [items, query])

  const today = filtered.filter((it) => isToday(it.updatedAt))
  const earlier = filtered.filter((it) => !isToday(it.updatedAt))

  return (
    <div className="rail left editions">
      <div className="ed-head">
        <div className="h">Editions</div>
        <button className="ed-new" onClick={onNew}>
          + New dispatch
        </button>
      </div>
      <input
        className="ed-search"
        placeholder="Search editions"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {today.length > 0 && <div className="ed-group">Today</div>}
      {today.map((it) => (
        <Row
          key={it.id}
          item={it}
          active={it.id === activeId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
      {earlier.length > 0 && <div className="ed-group">Earlier</div>}
      {earlier.map((it) => (
        <Row
          key={it.id}
          item={it}
          active={it.id === activeId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
