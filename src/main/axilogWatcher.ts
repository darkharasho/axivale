// Filesystem only — this module NEVER parses a log's contents. Fight labels
// come from arcdps's own filenames (20260830-211432.zevtc under a map folder),
// which is what lets the Logs panel list a night's fights instantly with
// nothing cached on disk.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'

export interface LogEntry {
  logId: string
  path: string
  /** Local wall-clock ISO-ish string parsed from the filename (no zone: arcdps writes local time). */
  startedAt: string
  mapFolder: string
  bytes: number
  source: 'watched' | 'opened'
}

/** Injected so tests never touch a real directory. */
export interface WatcherFs {
  exists(path: string): boolean
  listFiles(dir: string): Array<{ path: string; bytes: number }>
  statSize(path: string): number
}

export interface WatcherOptions {
  dir: () => string | null
  fs?: WatcherFs
  now?: () => number
  /** Entries retained in the registry. File metadata only — a few KB at 100. */
  maxEntries?: number
}

const LOG_NAME = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(zevtc|evtc|evtc\.zip)$/i
const SETTLE_AGE_MS = 60_000
export const MAX_REGISTRY_ENTRIES = 100

/** `20260830-211432.zevtc` -> its local start time. Null for anything else. */
export function parseLogFilename(name: string): { startedAt: string } | null {
  const m = LOG_NAME.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return { startedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}` }
}

/**
 * `startedAt` is arcdps's LOCAL wall-clock time with no zone. Parsing it as
 * `${startedAt}Z` (UTC) would skew the age by the machine's UTC offset — east
 * of UTC every file would look hours old the instant it appears, defeating
 * the mid-write settle check below. Read the components as local time instead
 * so the result is directly comparable to `Date.now()`.
 */
function startedAtToLocalMs(startedAt: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(startedAt)
  if (!m) return NaN
  const [, y, mo, d, h, mi, s] = m
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
}

/** Same local-time shape as `parseLogFilename`, built from the current clock. */
function nowAsLocalStartedAt(nowMs: number): string {
  const d = new Date(nowMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Stable across restarts so a conversation's stored refs still resolve tomorrow. */
export function logIdForPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 8)
}

/**
 * Where arcdps writes logs. On Linux the game runs under a Proton/Wine prefix,
 * so the same relative path hangs off a prefix root — hence the candidate list
 * rather than one path. Finding none is normal; the user picks the folder.
 */
export function defaultLogDirCandidates(home: string): string[] {
  const rel = join('Guild Wars 2', 'addons', 'arcdps', 'arcdps.cbtlogs')
  const winDocs = join(home, 'Documents', rel)
  const prefixDocs = (prefix: string): string =>
    join(prefix, 'drive_c', 'users', 'steamuser', 'Documents', rel)
  return [
    winDocs,
    prefixDocs(join(home, '.steam', 'steam', 'steamapps', 'compatdata', '1284210', 'pfx')),
    prefixDocs(join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata', '1284210', 'pfx')),
    prefixDocs(join(home, 'Games', 'guild-wars-2'))
  ]
}

const realFs: WatcherFs = {
  exists: (p) => existsSync(p),
  listFiles(dir) {
    const out: Array<{ path: string; bytes: number }> = []
    const walk = (d: string, depth: number): void => {
      if (depth > 3) return
      for (const dirent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, dirent.name)
        if (dirent.isDirectory()) walk(full, depth + 1)
        else if (parseLogFilename(dirent.name)) out.push({ path: full, bytes: statSync(full).size })
      }
    }
    try {
      walk(dir, 0)
    } catch {
      // An unreadable log dir is an empty list, never a crash.
    }
    return out
  },
  statSize: (p) => statSync(p).size
}

export class AxilogWatcher {
  private readonly entries = new Map<string, LogEntry>()
  /** Last observed size per path, for the settle check. */
  private readonly sizes = new Map<string, number>()
  private readonly dir: () => string | null
  private readonly fs: WatcherFs
  private readonly now: () => number
  private readonly maxEntries: number

  constructor(opts: WatcherOptions) {
    this.dir = opts.dir
    this.fs = opts.fs ?? realFs
    this.now = opts.now ?? (() => Date.now())
    this.maxEntries = opts.maxEntries ?? MAX_REGISTRY_ENTRIES
  }

  /**
   * Rescan the log dir. A file is admitted only once its size is stable across
   * two scans, or it is older than a minute — arcdps writes the log as the fight
   * ends, and a file caught mid-write parses as corrupt.
   */
  scan(): LogEntry[] {
    const dir = this.dir()
    if (!dir || !this.fs.exists(dir)) return this.watched()

    for (const { path, bytes } of this.fs.listFiles(dir)) {
      const parsed = parseLogFilename(basename(path))
      if (!parsed) continue
      const settledByAge = this.now() - startedAtToLocalMs(parsed.startedAt) > SETTLE_AGE_MS
      const previous = this.sizes.get(path)
      this.sizes.set(path, bytes)
      if (!settledByAge && (previous === undefined || previous !== bytes)) continue

      const logId = logIdForPath(path)
      if (!this.entries.has(logId)) {
        this.entries.set(logId, {
          logId,
          path,
          startedAt: parsed.startedAt,
          mapFolder: basename(dirname(path)),
          bytes,
          source: 'watched'
        })
      }
    }
    this.prune()
    return this.watched()
  }

  /** A file opened or dropped by the user, in the same registry as watched logs. */
  registerOpened(path: string): LogEntry {
    const logId = logIdForPath(path)
    const parsed = parseLogFilename(basename(path))
    const entry: LogEntry = {
      logId,
      path,
      startedAt: parsed?.startedAt ?? nowAsLocalStartedAt(this.now()),
      mapFolder: basename(dirname(path)),
      bytes: (() => {
        try {
          return this.fs.statSize(path)
        } catch {
          return 0
        }
      })(),
      source: 'opened'
    }
    this.entries.set(logId, entry)
    this.prune()
    return entry
  }

  resolve(logId: string): LogEntry | null {
    return this.entries.get(logId) ?? null
  }

  list(filter: { since?: string; limit?: number; map?: string } = {}): LogEntry[] {
    let rows = [...this.entries.values()]
    if (filter.since) rows = rows.filter((e) => e.startedAt >= filter.since!)
    if (filter.map) {
      const q = filter.map.toLowerCase()
      rows = rows.filter((e) => e.mapFolder.toLowerCase().includes(q))
    }
    rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    return filter.limit ? rows.slice(0, filter.limit) : rows
  }

  private watched(): LogEntry[] {
    return this.list().filter((e) => e.source === 'watched')
  }

  /** Opened entries survive pruning: the user asked for those explicitly. */
  private prune(): void {
    if (this.entries.size <= this.maxEntries) return
    const watched = this.list().filter((e) => e.source === 'watched')
    for (const stale of watched.slice(this.maxEntries)) this.entries.delete(stale.logId)
  }
}
