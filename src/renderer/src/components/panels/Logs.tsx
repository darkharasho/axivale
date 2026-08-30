import type { ReactElement } from 'react'
import type { LogsController } from './useLogs'

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Detail pane for the selected fight. The master list lives in LogsNav (left
 *  rail); both share one LogsController. Read-only — this panel never parses
 *  a log, and it must say why (not just show empty) when the folder is
 *  missing or the native parser is unavailable. */
export default function Logs({ ctl }: { ctl: LogsController }): ReactElement {
  const { status, current, pickDir } = ctl

  if (status.dir === null) {
    return (
      <div className="sk2-detail sk2-blank">
        <div className="panel-empty">No arcdps log folder found.</div>
        <button className="sbtn" onClick={() => void pickDir()}>
          Choose folder
        </button>
      </div>
    )
  }

  if (!status.available) {
    return (
      <div className="sk2-detail sk2-blank">
        <div className="panel-empty">
          Native log parser unavailable{status.reason ? ` — ${status.reason}` : ''}.
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="sk2-detail sk2-blank">
        <div className="panel-empty">Select a fight, or drop a .zevtc file into the composer.</div>
      </div>
    )
  }

  return (
    <div className="sk2-detail">
      <div className="sk2-head">
        <div className="sk2-head-txt">
          <div className="sk2-name-in">{current.mapFolder}</div>
          <div className="sk2-when-in">{current.startedAt.replace('T', ' ')}</div>
        </div>
      </div>
      <div className="sk2-body">
        <div className="sk2-preview prose">
          <p>Path: {current.path}</p>
          <p>Size: {fmtBytes(current.bytes)}</p>
          <p>Source: {current.source === 'watched' ? 'watched folder' : 'opened manually'}</p>
        </div>
      </div>
    </div>
  )
}
