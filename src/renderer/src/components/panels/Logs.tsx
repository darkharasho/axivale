import type { ReactElement } from 'react'
import type { LogsController } from './useLogs'

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Detail pane for the selected fight. The master list lives in LogsNav (left
 *  rail); both share one LogsController. Read-only — this panel never parses
 *  a log.
 *
 *  Honest degradation: the parser-unavailable reason and the missing/gone-
 *  folder message are independent facts about a 2x2 state space and are
 *  rendered independently, never as an if/else chain — a machine that lacks
 *  a native binary AND has no detected folder must be told both things, and
 *  picking a folder must never be the only visible action when it can't fix
 *  the real problem. The folder picker itself is always reachable, in every
 *  state, so an auto-detected-wrong or since-deleted folder is recoverable.
 *
 *  The detail pane is gated on nothing but `current`, deliberately: displaying
 *  a fight needs neither the watched folder (that is only needed to DISCOVER
 *  logs) nor the native parser (nothing here is parsed) — it is four strings
 *  out of the registry. A user with no arcdps install who drops a friend's log
 *  must see it. LogsNav lists every registry entry, so gating the pane on the
 *  folder would make the rail offer clicks that lead nowhere. */
export default function Logs({ ctl }: { ctl: LogsController }): ReactElement {
  const { status, error, current, pickDir, refresh } = ctl

  if (error) {
    return (
      <div className="sk2-detail sk2-blank">
        <div className="panel-empty">Couldn’t load logs — {error}</div>
        <button className="sbtn" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="sk2-detail sk2-blank">
        <div className="panel-empty">Checking for a log folder…</div>
      </div>
    )
  }

  const folderMissing = status.dir === null
  const folderGone = !folderMissing && !status.dirExists
  const needsFolder = folderMissing || folderGone

  return (
    <div className="sk2-detail">
      <div className="lg-status">
        {!status.available && (
          <div className="panel-empty">
            Native log parser unavailable{status.reason ? ` — ${status.reason}` : ''}.
          </div>
        )}
        {folderMissing && <div className="panel-empty">No arcdps log folder found.</div>}
        {folderGone && (
          <div className="panel-empty">Log folder no longer exists: {status.dir}</div>
        )}
        {!needsFolder && <div className="lg-folder-path">Folder: {status.dir}</div>}
        <button className="sbtn" onClick={() => void pickDir()}>
          Choose folder
        </button>
      </div>
      {current ? (
        <div className="sk2-body">
          <div className="sk2-head">
            <div className="sk2-head-txt">
              <div className="sk2-name-in">{current.mapFolder}</div>
              <div className="sk2-when-in">{current.startedAt.replace('T', ' ')}</div>
            </div>
          </div>
          <div className="sk2-preview prose">
            <p>Path: {current.path}</p>
            <p>Size: {fmtBytes(current.bytes)}</p>
            <p>Source: {current.source === 'watched' ? 'watched folder' : 'opened manually'}</p>
          </div>
        </div>
      ) : (
        <div className="sk2-blank">
          <div className="panel-empty">Select a fight, or drop a .zevtc file into the composer.</div>
        </div>
      )}
    </div>
  )
}
