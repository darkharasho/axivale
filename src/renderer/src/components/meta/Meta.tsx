import type { ReactElement } from 'react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import { Pane, Card } from '../panelui'
import ModeSummary from './ModeSummary'
import PlaybookLauncher from './PlaybookModal'
import MetaIndexInspector from '../MetaIndexInspector'
import { META_OVERVIEW } from './MetaNav'

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

export default function Meta({ modes, active, busy, fetching, onRefresh }: MetaProps): ReactElement {
  if (active === META_OVERVIEW) {
    return (
      <div className="settings meta-panel">
        <Pane
          no="00"
          title="Meta"
          sub="What AxiVale currently knows about the live meta per game mode. It refreshes automatically from the listed sources in the background and uses this to bias build and comp advice — nothing to edit."
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
        <Card title="Summary">
          <ModeSummary notes={m.notes} />
        </Card>
        <Card title="Sources">
          <div className="meta-srcs">
            {m.sources.map((s) => {
              const isFetching = fetching[m.id] === s.url
              const cls = isFetching ? 'fetching' : s.status
              return (
                <a
                  key={s.url}
                  className={`meta-srcchip ${cls}`}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.error ?? undefined}
                >
                  <span className="led" />
                  {s.label}
                  {isFetching ? ' · fetching…' : ''}
                </a>
              )
            })}
          </div>
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
