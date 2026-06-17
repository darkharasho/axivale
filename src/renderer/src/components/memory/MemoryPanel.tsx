import { useEffect, useState, useRef, type ReactElement } from 'react'
import type { RendererMemoryFact, RendererMemoryArtifact } from '../../../../preload/index.d'
import { Pane, Card } from '../panelui'

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `${hrs}h ago`
  return 'just now'
}

export default function MemoryPanel(): ReactElement {
  const [facts, setFacts] = useState<RendererMemoryFact[]>([])
  const [artifacts, setArtifacts] = useState<RendererMemoryArtifact[]>([])
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [newBody, setNewBody] = useState('')
  const [adding, setAdding] = useState(false)
  const [reindexing, setReindexing] = useState(false)

  async function load(): Promise<void> {
    const list = await window.officer.memoryList({ includeArchived: true })
    setFacts(list.facts)
    setArtifacts(list.artifacts)
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
    if (q && !f.body.toLowerCase().includes(q) && !(f.entity ?? '').toLowerCase().includes(q)) return false
    return true
  })
  const visibleArtifacts = artifacts.filter((a) => {
    if (!showArchived && a.archived) return false
    if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q)) return false
    return true
  })

  async function handlePin(f: RendererMemoryFact): Promise<void> {
    await window.officer.memoryPin(f.id, !f.pinned)
    void load()
  }

  async function handleArchive(f: RendererMemoryFact): Promise<void> {
    await window.officer.memoryUpdate('fact', f.id, { archived: true })
    void load()
  }

  async function handleDelete(f: RendererMemoryFact): Promise<void> {
    await window.officer.memoryDelete('fact', f.id)
    void load()
  }

  async function handleAddFact(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const body = newBody.trim()
    if (!body) return
    setAdding(true)
    try {
      await window.officer.memoryCreate({ kind: 'fact', body })
      setNewBody('')
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
                      aria-label={f.pinned ? 'Unpin' : 'Pin'}
                    >
                      {f.pinned ? 'unpin' : 'pin'}
                    </button>
                    {!f.archived && (
                      <button
                        className="rowbtn"
                        onClick={() => void handleArchive(f)}
                        aria-label="Archive"
                      >
                        archive
                      </button>
                    )}
                    <button
                      className="rowbtn zap"
                      onClick={() => void handleDelete(f)}
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
                      <span className="mem-badge kind">{a.kind}</span>
                      {a.entity && <span className="mem-badge entity">{a.entity}</span>}
                    </div>
                    <span className="mem-prov">{timeAgo(a.createdAt)}</span>
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
