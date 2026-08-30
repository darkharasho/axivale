import type { ReactElement } from 'react'
import type { LogsController } from './useLogs'

/** `2026-08-30T21:14:32` -> `21:14`; arcdps filenames carry no timezone. */
function timeOf(startedAt: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(startedAt)
  return m ? `${m[1]}:${m[2]}` : ''
}

/** Left-rail master list for the Logs tab, mirroring SkillsNav's structure:
 *  recent fights by map + local start time, newest first (useLogs already
 *  sorts via axilog:list). */
export default function LogsNav({ ctl }: { ctl: LogsController }): ReactElement {
  const { logs, activeId, select, status } = ctl
  return (
    <nav className="rail left sk2-rail">
      <div className="sk2-rail-h">
        <span className="sk2-kick">Logs · {logs.length}</span>
      </div>
      <ul className="sk2-items">
        {logs.map((l) => (
          <li
            key={l.logId}
            className={`sk2-item${l.logId === activeId ? ' on' : ''}`}
            onClick={() => select(l.logId)}
          >
            <span className="led" />
            <div className="sk2-item-txt">
              <div className="sk2-item-nm">{l.mapFolder}</div>
              <div className="sk2-item-wh">{timeOf(l.startedAt)}</div>
            </div>
          </li>
        ))}
        {logs.length === 0 && (
          <li className="sk2-empty">
            {status.dir === null ? 'No log folder found.' : 'No fights logged yet.'}
          </li>
        )}
      </ul>
    </nav>
  )
}
