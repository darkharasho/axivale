import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMemoryFact, RendererMemoryArtifact, RendererMemoryKind } from '../../../../preload/index.d'
import { Pane, Card } from '../panelui'

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return 'never'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `${hrs}h ago`
  return 'just now'
}

function shortDate(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleDateString()
}

type KindFilter = RendererMemoryKind | 'all'
const KIND_CHIPS: KindFilter[] = ['all', 'fact', 'playbook', 'anti_pattern', 'heuristic']

/** Display label for a memory kind — the chips/badges are CSS-uppercased, so the
 *  raw enum's underscore ("ANTI_PATTERN") reads as a jarring break. Hyphenate. */
const kindLabel = (k: KindFilter): string => (k === 'anti_pattern' ? 'anti-pattern' : k)

export default function MemoryPanel(): ReactElement {
  const [facts, setFacts] = useState<RendererMemoryFact[]>([])
  const [artifacts, setArtifacts] = useState<RendererMemoryArtifact[]>([])
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [newBody, setNewBody] = useState('')
  const [newEntity, setNewEntity] = useState('')
  const [adding, setAdding] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [stats, setStats] = useState<{ total: number; lastIndexedAt: string | null } | null>(null)

  async function load(): Promise<void> {
    // Load all (incl. archived) once; the show-archived toggle + filters run client-side.
    const list = await window.officer.memoryList({ includeArchived: true })
    setFacts(list.facts)
    setArtifacts(list.artifacts)
    if (typeof window.officer.memoryIndexStats === 'function') {
      void window.officer.memoryIndexStats().then((s) =>
        setStats({ total: s.total, lastIndexedAt: s.lastIndexedAt })
      )
    }
  }

  useEffect(() => {
    void load()
    const unsub = window.officer.onMemoryProgress(() => {
      void load()
    })
    return unsub
  }, [])

  const q = search.toLowerCase()
  const visibleFacts = facts.filter((f) => {
    if (!showArchived && f.archived) return false
    if (kind !== 'all' && kind !== 'fact') return false
    if (q && !f.body.toLowerCase().includes(q) && !(f.entity ?? '').toLowerCase().includes(q)) return false
    return true
  })
  const visibleArtifacts = artifacts.filter((a) => {
    if (!showArchived && a.archived) return false
    if (kind !== 'all' && kind !== a.kind) return false
    if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q)) return false
    return true
  })

  async function handlePin(f: RendererMemoryFact): Promise<void> {
    await window.officer.memoryPin(f.id, !f.userPinned)
    void load()
  }

  async function handleArchiveFact(f: RendererMemoryFact): Promise<void> {
    await window.officer.memoryUpdate('fact', f.id, { archived: !f.archived })
    void load()
  }

  async function handleDeleteFact(f: RendererMemoryFact): Promise<void> {
    await window.officer.memoryDelete('fact', f.id)
    void load()
  }

  async function handleArchiveArtifact(a: RendererMemoryArtifact): Promise<void> {
    await window.officer.memoryUpdate('artifact', a.id, { archived: !a.archived })
    void load()
  }

  async function handleDeleteArtifact(a: RendererMemoryArtifact): Promise<void> {
    await window.officer.memoryDelete('artifact', a.id)
    void load()
  }

  async function handleAddFact(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const body = newBody.trim()
    if (!body) return
    setAdding(true)
    try {
      await window.officer.memoryCreate({ kind: 'fact', body, entity: newEntity.trim() || null })
      setNewBody('')
      setNewEntity('')
      void load()
    } finally {
      setAdding(false)
    }
  }

  async function handleReindex(): Promise<void> {
    setReindexing(true)
    try {
      await window.officer.memoryReindex()
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="settings meta-panel">
      <Pane
        no="M"
        title="Memory"
        sub="Facts and artifacts the assistant has learned or that you have added. Pinned items are always recalled; archived items are hidden by default."
      >
        {/* Stats bar */}
        <div className="meta-pane-status">
          <span className="meta-fresh">
            {stats ? `${stats.total} indexed · updated ${shortDate(stats.lastIndexedAt)}` : 'loading…'}
          </span>
        </div>

        {/* Filters row */}
        <div className="mem-filters">
          <input
            className="mem-search"
            type="text"
            placeholder="Search memory…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className={`sbtn out mem-arch-toggle${showArchived ? ' on' : ''}`}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>

        {/* Kind filter chips */}
        <div className="meta-srcs" style={{ marginBottom: 18 }}>
          {KIND_CHIPS.map((k) => (
            <button
              key={k}
              className={`meta-srcchip mem-chip${kind === k ? ' on' : ''}`}
              onClick={() => setKind(k)}
            >
              {kindLabel(k)}
            </button>
          ))}
        </div>

        {/* Facts */}
        <Card title={`Facts · ${visibleFacts.length}`}>
          {visibleFacts.length === 0 ? (
            <div className="panel-empty">No facts yet.</div>
          ) : (
            <div className="mem-list">
              {visibleFacts.map((f) => (
                <div key={f.id} className={`mem-row${f.archived ? ' mem-archived' : ''}`}>
                  <div className="mem-body">{f.body}</div>
                  <div className="mem-meta">
                    <div className="mem-badges">
                      {f.pinned && <span className="mem-badge pinned">pinned</span>}
                      {f.archived && <span className="mem-badge archived">archived</span>}
                      <span className="mem-badge source">{f.source}</span>
                      {f.entity && <span className="mem-badge entity">{f.entity}</span>}
                    </div>
                    <span className="mem-prov">{timeAgo(f.createdAt)}</span>
                  </div>
                  <div className="mem-acts">
                    <button
                      className="rowbtn"
                      onClick={() => void handlePin(f)}
                      aria-label={f.userPinned ? 'Unpin' : 'Pin'}
                    >
                      {f.userPinned ? 'unpin' : 'pin'}
                    </button>
                    <button
                      className="rowbtn"
                      onClick={() => void handleArchiveFact(f)}
                      aria-label={f.archived ? 'Restore' : 'Archive'}
                    >
                      {f.archived ? 'restore' : 'archive'}
                    </button>
                    <button
                      className="rowbtn zap"
                      onClick={() => void handleDeleteFact(f)}
                      aria-label="Delete"
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add fact form */}
          <form className="mem-add-form" onSubmit={(e) => void handleAddFact(e)}>
            <textarea
              className="mem-add-input"
              placeholder="New fact…"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              rows={2}
            />
            <input
              className="mem-add-input"
              placeholder="about (name, optional)"
              value={newEntity}
              onChange={(e) => setNewEntity(e.target.value)}
            />
            <button className="sbtn" type="submit" disabled={adding || !newBody.trim()}>
              {adding ? 'Adding…' : 'Add fact'}
            </button>
          </form>
        </Card>

        {/* Artifacts */}
        <Card title={`Artifacts · ${visibleArtifacts.length}`}>
          {visibleArtifacts.length === 0 ? (
            <div className="panel-empty">No artifacts yet.</div>
          ) : (
            <div className="mem-list">
              {visibleArtifacts.map((a) => (
                <div key={a.id} className={`mem-row${a.archived ? ' mem-archived' : ''}`}>
                  <div className="mem-body">
                    <strong className="mem-title">{a.title}</strong>
                    <span className="mem-abody">{a.body}</span>
                  </div>
                  <div className="mem-meta">
                    <div className="mem-badges">
                      {a.archived && <span className="mem-badge archived">archived</span>}
                      <span className="mem-badge source">{a.source}</span>
                      <span className="mem-badge kind">{kindLabel(a.kind)}</span>
                      {a.entity && <span className="mem-badge entity">{a.entity}</span>}
                    </div>
                    <span className="mem-prov">{timeAgo(a.createdAt)}</span>
                  </div>
                  <div className="mem-acts">
                    <button
                      className="rowbtn"
                      onClick={() => void handleArchiveArtifact(a)}
                      aria-label={a.archived ? 'Restore' : 'Archive'}
                    >
                      {a.archived ? 'restore' : 'archive'}
                    </button>
                    <button
                      className="rowbtn zap"
                      onClick={() => void handleDeleteArtifact(a)}
                      aria-label="Delete artifact"
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Maintenance */}
        <Card title="Maintenance">
          <div className="sactions" style={{ marginTop: 0 }}>
            <button
              className="sbtn"
              onClick={() => void handleReindex()}
              disabled={reindexing}
            >
              {reindexing ? 'Rebuilding…' : 'Rebuild index'}
            </button>
          </div>
          <p className="shelp">
            Rebuilds the semantic search index from all non-archived memory entries. Run this after
            bulk imports or if recall quality degrades.
          </p>
        </Card>
      </Pane>
    </div>
  )
}
