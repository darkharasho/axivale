import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { Worker } from 'node:worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { extractRunSummary, type RunSummary } from '@axiapps/bridge-metrics'

export interface SummaryJob {
  id: string
  reportPath: string
  summaryPath: string
}

export interface SummaryJobResult {
  summaries: RunSummary[]
  skipped: Array<{ id: string; reason: string }>
}

/**
 * Synchronous job runner shared by the worker thread and unit tests.
 * Parsing a 30 MB report.json is the expensive part — once a run's summary
 * exists on disk it is reused and the raw report is never re-parsed.
 */
export function runSummaryJobs(jobs: SummaryJob[]): SummaryJobResult {
  const summaries: RunSummary[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  for (const job of jobs) {
    try {
      if (existsSync(job.summaryPath)) {
        summaries.push(JSON.parse(readFileSync(job.summaryPath, 'utf8')) as RunSummary)
        continue
      }
      const report = JSON.parse(readFileSync(job.reportPath, 'utf8'))
      const summary = extractRunSummary(report)
      mkdirSync(dirname(job.summaryPath), { recursive: true }) // cache summary/ dir is created lazily
      writeFileSync(job.summaryPath, JSON.stringify(summary))
      summaries.push(summary)
    } catch (err) {
      skipped.push({ id: job.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { summaries, skipped }
}

/**
 * Run the jobs in a worker thread so a season of 30 MB parses never blocks main.
 * The worker compiles to its own entry alongside the main bundle (electron.vite.config.ts);
 * the package is `type: module`, so the emitted `.js` worker loads as ESM.
 *
 * @param workerPath - override the worker bundle path (used in tests to inject a bad path).
 */
export function summarizeInWorker(
  jobs: SummaryJob[],
  workerPath: string = join(dirname(fileURLToPath(import.meta.url)), 'axibridgeWorker.js'),
): Promise<SummaryJobResult> {
  if (jobs.length === 0) return Promise.resolve({ summaries: [], skipped: [] })
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { jobs } })
    let settled = false
    worker.once('message', (result: SummaryJobResult) => {
      settled = true
      resolve(result)
      void worker.terminate()
    })
    worker.once('error', (err) => {
      settled = true
      reject(err)
    })
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`Summary worker exited (code ${code}) before returning a result`))
    })
  })
}
