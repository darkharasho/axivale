import { useEffect, useState } from 'react'
import type { AxilogStatus, RendererLogEntry } from '../../../../preload/index.d'

export interface LogsController {
  logs: RendererLogEntry[]
  /** null until the first load resolves — distinct from a genuine no-folder
   *  status, so the panel can paint a neutral "checking" state instead of
   *  guessing. */
  status: AxilogStatus | null
  /** Set when the last refresh() failed; takes priority over status so an IPC
   *  failure never reads as "no folder found". */
  error: string | null
  activeId: string | null
  current: RendererLogEntry | null
  select: (logId: string) => void
  refresh: () => Promise<void>
  pickDir: () => Promise<void>
}

/** Shared log-panel state for the left-rail list (LogsNav) + the detail pane
 *  (Logs), lifted to App and mirroring useSkills. Read-only: it never parses a
 *  log, and the only write anywhere in this surface is pickDir persisting the
 *  chosen folder (via axilog:pick-dir in main).
 *
 *  Unlike useSkills, the first fight is never auto-selected: a raw combat log
 *  has no name of its own worth spotlighting the way a skill's title does, so
 *  opening on "select a fight" avoids implying the most recent one is special
 *  and matches how a user actually works this panel — scan the list, then
 *  pick one. */
export function useLogs(): LogsController {
  const [logs, setLogs] = useState<RendererLogEntry[]>([])
  const [status, setStatus] = useState<AxilogStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      const [s, list] = await Promise.all([window.officer.axilogStatus(), window.officer.axilogList()])
      setStatus(s)
      setLogs(list)
      setError(null)
      setActiveId((prev) => (prev && list.some((l) => l.logId === prev) ? prev : null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pickDir(): Promise<void> {
    const dir = await window.officer.axilogPickDir()
    if (dir) await refresh()
  }

  function select(logId: string): void {
    setActiveId(logId)
  }

  const current = activeId ? (logs.find((l) => l.logId === activeId) ?? null) : null

  return { logs, status, error, activeId, current, select, refresh, pickDir }
}
