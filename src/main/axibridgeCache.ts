import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync
} from 'fs'
import { join, dirname } from 'path'
import type { RepoRef } from './axibridgeRepos'

export const DEFAULT_CACHE_CAP_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
export const META_TTL_MS = 5 * 60_000 // index/rollup freshness window

export interface CacheOptions {
  dir: string
  capBytes: number
  ttlMs: number
  /** injectable clock for tests */
  now?: () => number
}

interface LedgerEntry {
  size: number
  lastAccess: number
  fetchedAt: number
}

interface Ledger {
  // key: "<owner>__<repo>/<kind>/<id>" — kind 'report' | 'summary' | 'meta'
  entries: Record<string, LedgerEntry>
}

/**
 * Disk cache for AxiBridge report repos.
 * - reports/  immutable forever, keyed repo/reportId, LRU-evicted past capBytes
 * - summaries/ extracted per-run summaries — small, never evicted
 * - meta/      index.json + rollup.json — TTL'd (~5 min)
 */
export class AxibridgeCache {
  private readonly now: () => number

  constructor(private readonly opts: CacheOptions) {
    this.now = opts.now ?? Date.now
    mkdirSync(opts.dir, { recursive: true })
  }

  private repoDir(repo: RepoRef): string {
    return join(this.opts.dir, `${repo.owner}__${repo.repo}`)
  }

  private ledgerPath(): string {
    return join(this.opts.dir, 'ledger.json')
  }

  private readLedger(): Ledger {
    try {
      return JSON.parse(readFileSync(this.ledgerPath(), 'utf8')) as Ledger
    } catch {
      return { entries: {} }
    }
  }

  private writeLedger(ledger: Ledger): void {
    const target = this.ledgerPath()
    const tmp = `${target}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(ledger))
    renameSync(tmp, target)
  }

  private key(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string): string {
    return `${repo.owner}__${repo.repo}/${kind}/${id}`
  }

  private pathFor(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string): string {
    return join(this.repoDir(repo), kind, `${id}.json`)
  }

  private put(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string, body: string): void {
    const path = this.pathFor(repo, kind, id)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
    const ledger = this.readLedger()
    ledger.entries[this.key(repo, kind, id)] = {
      size: Buffer.byteLength(body),
      lastAccess: this.now(),
      fetchedAt: this.now()
    }
    this.writeLedger(ledger)
    if (kind === 'report') this.enforceCap()
  }

  private read(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string): string | null {
    const path = this.pathFor(repo, kind, id)
    if (!existsSync(path)) return null
    const ledger = this.readLedger()
    const entry = ledger.entries[this.key(repo, kind, id)]
    if (kind === 'meta') {
      if (!entry || this.now() - entry.fetchedAt > this.opts.ttlMs) return null
    }
    if (entry) {
      entry.lastAccess = this.now()
      this.writeLedger(ledger)
    }
    return readFileSync(path, 'utf8')
  }

  putReport(repo: RepoRef, id: string, body: string): void {
    this.put(repo, 'report', id, body)
  }
  readReport(repo: RepoRef, id: string): string | null {
    return this.read(repo, 'report', id)
  }
  reportPath(repo: RepoRef, id: string): string {
    return this.pathFor(repo, 'report', id)
  }
  hasReport(repo: RepoRef, id: string): boolean {
    return existsSync(this.pathFor(repo, 'report', id))
  }

  putSummary(repo: RepoRef, id: string, body: string): void {
    this.put(repo, 'summary', id, body)
  }
  readSummary(repo: RepoRef, id: string): string | null {
    return this.read(repo, 'summary', id)
  }
  summaryPath(repo: RepoRef, id: string): string {
    return this.pathFor(repo, 'summary', id)
  }

  putMeta(repo: RepoRef, name: 'index' | 'rollup', body: string): void {
    this.put(repo, 'meta', name, body)
  }
  readMeta(repo: RepoRef, name: 'index' | 'rollup'): string | null {
    return this.read(repo, 'meta', name)
  }

  /** LRU eviction over reports only — extracted summaries always survive. */
  private enforceCap(): void {
    const ledger = this.readLedger()
    const reports = Object.entries(ledger.entries)
      .filter(([key]) => key.includes('/report/'))
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess) // oldest first
    let total = reports.reduce((sum, [, e]) => sum + e.size, 0)
    for (const [key, entry] of reports) {
      if (total <= this.opts.capBytes) break
      const [repoPart, , id] = key.split('/')
      const [owner, repoName] = repoPart.split('__')
      const path = this.pathFor({ owner, repo: repoName }, 'report', id)
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        continue // keep the ledger honest only for what we actually removed
      }
      delete ledger.entries[key]
      total -= entry.size
    }
    this.writeLedger(ledger)
  }

  repoStats(repo: RepoRef): { cachedReports: number; lastIndexFetch: number | null; cacheBytes: number } {
    const reportsDir = join(this.repoDir(repo), 'report')
    let cachedReports = 0
    let cacheBytes = 0
    if (existsSync(reportsDir)) {
      for (const file of readdirSync(reportsDir)) {
        cachedReports += 1
        cacheBytes += statSync(join(reportsDir, file)).size
      }
    }
    const entry = this.readLedger().entries[this.key(repo, 'meta', 'index')]
    return { cachedReports, lastIndexFetch: entry?.fetchedAt ?? null, cacheBytes }
  }
}
