import { useEffect, useState } from 'react'
import type { AxilogStatus, RendererLogEntry } from '../../../../preload/index.d'

const EMPTY_STATUS: AxilogStatus = { dir: null, available: true, reason: null, count: 0 }

export interface LogsController {
  logs: RendererLogEntry[]
  status: AxilogStatus
  activeId: string | null
  current: RendererLogEntry | null
  select: (logId: string) => void
  refresh: () => Promise<void>
  pickDir: () => Promise<void>
}

/** Shared log-panel state for the left-rail list (LogsNav) + the detail pane
 *  (Logs), lifted to App and mirroring useSkills. Read-only: it never parses a
 *  log, and the only write anywhere in this surface is pickDir persisting the
 *  chosen folder (via axilog:pick-dir in main). */
export function useLogs(): LogsController {
  const [logs, setLogs] = useState<RendererLogEntry[]>([])
  const [status, setStatus] = useState<AxilogStatus>(EMPTY_STATUS)
  const [activeId, setActiveId] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const [s, list] = await Promise.all([window.officer.axilogStatus(), window.officer.axilogList()])
    setStatus(s)
    setLogs(list)
    // Unlike Skills, don't auto-select the first fight: the rail and detail
    // pane would then both show its map name as plain text, and nothing here
    // depends on a selection existing (the empty state just prompts to pick one).
    setActiveId((prev) => (prev && list.some((l) => l.logId === prev) ? prev : null))
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

  return { logs, status, activeId, current, select, refresh, pickDir }
}
