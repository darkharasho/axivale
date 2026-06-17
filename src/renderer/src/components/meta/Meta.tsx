import { useEffect, useState, type ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import { Pane, Card } from '../panelui'
import ModeSummary from './ModeSummary'
import PlaybookLauncher from './PlaybookModal'
import MetaIndexInspector from '../MetaIndexInspector'
import { META_OVERVIEW, WIKI_REF } from './MetaNav'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return 'never'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `updated ${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `updated ${hrs}h ago`
  return 'updated just now'
}

export interface MetaProps {
  modes: RendererMetaMode[]
  active: string
  busy: Record<string, boolean>
  fetching: Record<string, string | null>
  onRefresh: () => void
}

interface WikiStats {
  total: number
  byMode: Record<string, number>
  lastIndexedAt: string | null
}

/** Wiki reference corpus view: holistic GW2-wiki coverage with a live fallback. */
function WikiPanel(): ReactElement {
  const [stats, setStats] = useState<WikiStats | null>(null)
  useEffect(() => {
    void window.officer.wikiIndexStats().then((s) => setStats(s as WikiStats))
  }, [])
  const cats = stats ? Object.entries(stats.byMode).sort((a, b) => b[1] - a[1]) : []
  return (
    <div className="settings meta-panel">
      <Pane
        no="W"
        title="Wiki"
        sub="The holistic GW2-wiki reference the assistant searches for game mechanics, legendary crafting, achievements, and masteries."
      >
        <div className="meta-pane-status">
          <span className="meta-fresh">
            {stats ? `${stats.total} chunks · ${ago(stats.lastIndexedAt)}` : 'loading…'}
          </span>
        </div>
        <Card title="Indexed categories">
          {cats.length === 0 ? (
            <div className="panel-empty">No wiki reference indexed yet — the background ingest runs in the background.</div>
          ) : (
            <div className="meta-srcs">
              {cats.map(([cat, count]) => (
                <span key={cat} className="meta-srcchip ok">
                  <span className="led" />
                  {cat} · {count}
                </span>
              ))}
            </div>
          )}
        </Card>
        <Card title="Coverage">
          <div className="meta-note">
            Curated high-value pages (legendaries, masteries, mechanics, skills/traits/upgrades) are
            pre-indexed for instant recall; anything not covered falls back to a live wiki lookup at
            query time, so the long tail stays answerable.
          </div>
        </Card>
      </Pane>
    </div>
  )
}

export default function Meta({ modes, active, busy, fetching, onRefresh }: MetaProps): ReactElement {
  if (active === META_OVERVIEW) {
    return (
      <div className="settings meta-panel">
        <Pane
          no="00"
          title="Sources"
          sub="The knowledge AxiVale draws on for recall — grouped as Meta (live build/comp meta per game mode), Wiki (holistic GW2-wiki reference), and General (long-form guides). It refreshes automatically in the background; nothing to edit."
        >
          {import.meta.env.DEV && (
            <Card title="Developer">
              <div className="sactions" style={{ marginTop: 0 }}>
                <button className="sbtn" onClick={() => void window.officer.metaForceRefresh()}>
                  Force re-crawl
                </button>
              </div>
            </Card>
          )}
          {modes.length === 0 && <div className="panel-empty">No meta modes.</div>}
        </Pane>
        {import.meta.env.DEV && <MetaIndexInspector />}
      </div>
    )
  }

  if (active === WIKI_REF) return <WikiPanel />

  const m = modes.find((x) => x.id === active)
  if (!m) {
    return (
      <div className="settings meta-panel">
        <div className="panel-empty">Select a mode.</div>
      </div>
    )
  }

  const status = busy[m.id] ? (
    <span className="meta-refreshing">
      <span className="meta-spin" /> refreshing…
    </span>
  ) : (
    <span className="meta-fresh">{ago(m.refreshedAt)}</span>
  )

  return (
    <div className="settings meta-panel">
      <Pane no={String(modes.indexOf(m) + 1).padStart(2, '0')} title={m.mode} sub="">
        <div className="meta-pane-status">{status}</div>
        {/* Guides are prose, not builds — there's no build-tier table to summarize. */}
        {m.mode !== 'Guides' && (
          <Card title="Summary">
            <ModeSummary notes={m.notes} />
          </Card>
        )}
        <Card title="Sources">
          {(['meta', 'wiki', 'general'] as const).map((g) => {
            const srcs = m.sources.filter((s) => (s.group ?? 'meta') === g)
            if (srcs.length === 0) return null
            return (
              <div key={g} className="meta-srcgroup">
                <div className="meta-srcgroup-h">{g === 'general' ? 'guides' : g}</div>
                <div className="meta-srcs">
                  {srcs.map((s) => {
                    const isFetching = fetching[m.id] === s.url
                    const cls = isFetching ? 'fetching' : s.status
                    return (
                      <a key={s.url} className={`meta-srcchip ${cls}`} href={s.url} target="_blank" rel="noreferrer" title={s.error ?? undefined}>
                        <span className="led" />
                        {s.label}
                        {isFetching ? ' · fetching…' : ''}
                      </a>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </Card>
        {/* Squad-comp playbook is WvW-only; Roaming/PvE never show it. */}
        {m.mode === 'WvW' && (
          <Card title="Comp playbook">
            <PlaybookLauncher mode={m} onChange={onRefresh} />
          </Card>
        )}
      </Pane>
    </div>
  )
}
