// The only module that knows a worker exists. Owns the worker lifecycle
// (spawn on demand, idle-kill), request correlation, and the guards. Swapping
// worker_threads for Electron's utilityProcess later is a change to this file
// and nothing else.

import { Worker } from 'node:worker_threads'
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PassFlags, WorkerRequest, WorkerResponse } from './axilogWorker'
import type { SectionQuery, SectionResult } from './axilogSections'
import type { CoverageState } from './axilogEntities'

export const MAX_LOG_BYTES = 150 * 1024 * 1024
export const PARSE_TIMEOUT_MS = 30_000
export const IDLE_KILL_MS = 5 * 60_000

export interface FightOverview {
  logId: string
  map: string
  durationMs: number
  recordedBy: string
  roleCounts: Record<string, number>
  squad: Array<{ name: string; account: string; profession: string; subgroup: number | null }>
  coverage: Record<string, CoverageState>
  warnings: string[]
}

/** Just enough of node:worker_threads' Worker to fake in tests. */
interface WorkerLike {
  postMessage(value: unknown): void
  terminate(): Promise<number>
  on(event: 'message' | 'error' | 'exit', cb: (arg: never) => void): void
}

/**
 * `Omit` over a union collapses to the union's COMMON keys, which would make
 * `{kind: 'section', ..., passes}` fail excess-property checking. Distributing
 * keeps each variant intact.
 */
type Unidentified<T> = T extends unknown ? Omit<T, 'id'> : never

export interface AxilogServiceOptions {
  workerPath?: string
  /** Injected so size-guard tests never touch the filesystem. */
  statSize?: (path: string) => number
  parseTimeoutMs?: number
  idleKillMs?: number
  spawn?: (workerPath: string) => WorkerLike
  maxLogBytes?: number
}

const defaultWorkerPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), 'axilogWorker.js')

export class AxilogService {
  private worker: WorkerLike | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private idleTimer: NodeJS.Timeout | null = null

  private readonly workerPath: string
  private readonly statSize: (path: string) => number
  private readonly parseTimeoutMs: number
  private readonly idleKillMs: number
  private readonly maxLogBytes: number
  private readonly spawn: (workerPath: string) => WorkerLike
  /** A fake spawn has no bundle on disk, so the existsSync guard must not apply. */
  private readonly spawnInjected: boolean

  constructor(opts: AxilogServiceOptions = {}) {
    this.workerPath = opts.workerPath ?? defaultWorkerPath()
    this.statSize = opts.statSize ?? ((p) => statSync(p).size)
    this.parseTimeoutMs = opts.parseTimeoutMs ?? PARSE_TIMEOUT_MS
    this.idleKillMs = opts.idleKillMs ?? IDLE_KILL_MS
    this.maxLogBytes = opts.maxLogBytes ?? MAX_LOG_BYTES
    this.spawn = opts.spawn ?? ((p) => new Worker(p) as unknown as WorkerLike)
    this.spawnInjected = opts.spawn !== undefined
  }

  workerIsRunning(): boolean {
    return this.worker !== null
  }

  async overview(logId: string, path: string): Promise<FightOverview> {
    return (await this.send(path, { kind: 'overview', logId, path })) as FightOverview
  }

  async section(
    logId: string,
    path: string,
    section: string,
    opts: SectionQuery,
    passes: PassFlags = {}
  ): Promise<SectionResult> {
    return (await this.send(path, {
      kind: 'section',
      logId,
      path,
      section,
      opts,
      passes
    })) as SectionResult
  }

  async query(
    logId: string,
    path: string,
    filter: string,
    limit: number
  ): Promise<{ rows: unknown[]; truncated: boolean }> {
    return (await this.send(path, { kind: 'query', logId, path, filter, limit })) as {
      rows: unknown[]
      truncated: boolean
    }
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('AxiLog service disposed'))
    }
    this.pending.clear()
    void this.worker?.terminate()
    this.worker = null
  }

  private guard(path: string): void {
    let size: number
    try {
      size = this.statSize(path)
    } catch {
      throw new Error(`log no longer at ${path}`)
    }
    if (size > this.maxLogBytes) {
      const mb = Math.round(size / 1024 / 1024)
      const capMb = Math.round(this.maxLogBytes / 1024 / 1024)
      throw new Error(`Log is too large to parse (${mb} MB, limit ${capMb} MB)`)
    }
  }

  /**
   * Fail every in-flight request at once. Any event that ends the worker
   * (error, exit, a timeout that terminates it) invalidates ALL pending
   * requests, not just the one that noticed — leaving the others armed would
   * make each wait out its own timeout and then blame the wrong cause.
   */
  private drainPending(error: Error): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.pending.clear()
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    if (!this.spawnInjected && !existsSync(this.workerPath)) {
      throw new Error(
        `AxiLog worker bundle missing at ${this.workerPath} — run \`npm run build\` (electron-vite emits it as a second main entry)`
      )
    }
    const worker = this.spawn(this.workerPath)
    worker.on('message', ((res: WorkerResponse) => {
      const entry = this.pending.get(res.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(res.id)
      if (res.ok) entry.resolve(res.value)
      else entry.reject(new Error(res.error))
      this.armIdleKill()
    }) as (arg: never) => void)
    worker.on('error', ((err: Error) => {
      this.worker = null
      this.drainPending(err)
    }) as (arg: never) => void)
    // A worker can die WITHOUT emitting 'error' — an OOM kill, or a native
    // addon calling process.exit. Without this, `pending` and `this.worker`
    // would both survive a dead worker and workerIsRunning() would lie.
    worker.on('exit', ((code: number) => {
      if (this.worker !== worker) return
      this.worker = null
      this.drainPending(new Error(`AxiLog worker exited unexpectedly (code ${code})`))
    }) as (arg: never) => void)
    this.worker = worker
    return worker
  }

  /** Five minutes idle and the worker exits, taking every parsed report with it. */
  private armIdleKill(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.pending.size > 0) return
    this.idleTimer = setTimeout(() => {
      void this.worker?.terminate()
      this.worker = null
    }, this.idleKillMs)
    this.idleTimer.unref?.()
  }

  private send(path: string, req: Unidentified<WorkerRequest>): Promise<unknown> {
    this.guard(path)
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        void this.worker?.terminate()
        this.worker = null
        // Terminating takes every other in-flight request down with it, so they
        // are drained here with an honest cause rather than each timing out
        // later against a worker that is already gone.
        this.drainPending(
          new Error('AxiLog worker was terminated because another request timed out')
        )
        reject(new Error(`AxiLog parse timed out after ${this.parseTimeoutMs}ms`))
      }, this.parseTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }
}
