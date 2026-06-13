import type { RepoRef } from './axibridgeRepos'
import { repoKey } from './axibridgeRepos'
import { AxibridgeClient, type ReportIndexEntry, type DownloadProgress } from './axibridgeClient'
import { AxibridgeCache } from './axibridgeCache'
import type { SummaryJob, SummaryJobResult } from './axibridgeSummarize'
import {
  aggregatePlayers, compareRunSets, buildRollupData, extractRollupSource,
  type RunSummary, type RollupData, type RollupReportPayload
} from '@axiapps/bridge-metrics'

export interface AxibridgeServiceDeps {
  repos: () => RepoRef[]
  client: AxibridgeClient
  cache: AxibridgeCache
  summarize: (jobs: SummaryJob[]) => Promise<SummaryJobResult>
  /** UI progress: "fetching run 3 of 12" */
  onProgress: (message: string, detail?: DownloadProgress) => void
}

export interface RunListEntry extends ReportIndexEntry {
  repo: string
}

export interface DateRange {
  from?: string
  to?: string
}

const inRange = (entry: ReportIndexEntry, range: DateRange): boolean => {
  const date = entry.dateStart ?? entry.dateEnd
  if (!date) return true
  if (range.from && date < range.from) return false
  if (range.to && date.slice(0, 10) > range.to) return false
  return true
}

export class AxibridgeService {
  constructor(private readonly deps: AxibridgeServiceDeps) {}

  private requireRepos(): RepoRef[] {
    const repos = this.deps.repos()
    if (repos.length === 0) {
      throw new Error('No AxiBridge report repos linked — add one in Settings (owner/repo or Pages URL).')
    }
    return repos
  }

  /** index.json per repo, cache-first (5 min TTL). Errors isolated per repo. */
  private async indexFor(repo: RepoRef): Promise<ReportIndexEntry[]> {
    const cached = this.deps.cache.readMeta(repo, 'index')
    if (cached) return JSON.parse(cached) as ReportIndexEntry[]
    const entries = await this.deps.client.fetchIndex(repo)
    this.deps.cache.putMeta(repo, 'index', JSON.stringify(entries))
    return entries
  }

  async reposStatus(): Promise<{
    repos: Array<{ repo: string; runs: number; firstRun: string | null; lastRun: string | null; cachedReports: number; lastIndexFetch: number | null; error: string | null }>
  }> {
    const out = []
    for (const repo of this.deps.repos()) {
      const stats = this.deps.cache.repoStats(repo)
      try {
        const entries = await this.indexFor(repo)
        const dates = entries.map((e) => e.dateStart).filter((d): d is string => !!d).sort()
        out.push({
          repo: repoKey(repo), runs: entries.length,
          firstRun: dates[0] ?? null, lastRun: dates[dates.length - 1] ?? null,
          cachedReports: stats.cachedReports, lastIndexFetch: stats.lastIndexFetch, error: null
        })
      } catch (err) {
        out.push({
          repo: repoKey(repo), runs: 0, firstRun: null, lastRun: null,
          cachedReports: stats.cachedReports, lastIndexFetch: stats.lastIndexFetch,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return { repos: out }
  }

  async runsList(filter: DateRange & { repo?: string }): Promise<{ runs: RunListEntry[]; errors: string[] }> {
    const repos = this.requireRepos().filter((r) => !filter.repo || repoKey(r) === filter.repo)
    const runs: RunListEntry[] = []
    const errors: string[] = []
    for (const repo of repos) {
      try {
        for (const entry of await this.indexFor(repo)) {
          if (inRange(entry, filter)) runs.push({ ...entry, repo: repoKey(repo) })
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err)) // other repos unaffected
      }
    }
    runs.sort((a, b) => String(b.dateStart ?? '').localeCompare(String(a.dateStart ?? '')))
    return { runs, errors }
  }

  /** Download any uncached reports (with progress), then summarize via the worker. */
  async summariesFor(runs: RunListEntry[]): Promise<{ summaries: RunSummary[]; skippedRuns: Array<{ id: string; reason: string }> }> {
    const repos = new Map(this.deps.repos().map((r) => [repoKey(r), r]))
    const jobs: SummaryJob[] = []
    let fetched = 0
    const toFetch = runs.filter((run) => {
      const repo = repos.get(run.repo)
      return repo && !this.deps.cache.hasReport(repo, run.id) && !this.deps.cache.readSummary(repo, run.id)
    })
    for (const run of runs) {
      const repo = repos.get(run.repo)
      if (!repo) continue
      if (!this.deps.cache.hasReport(repo, run.id) && !this.deps.cache.readSummary(repo, run.id)) {
        fetched += 1
        this.deps.onProgress(`fetching run ${fetched} of ${toFetch.length}`)
        const body = JSON.stringify(await this.deps.client.fetchReport(repo, run.id))
        this.deps.cache.putReport(repo, run.id, body)
      }
      jobs.push({
        id: run.id,
        reportPath: this.deps.cache.reportPath(repo, run.id),
        summaryPath: this.deps.cache.summaryPath(repo, run.id)
      })
    }
    const result = await this.deps.summarize(jobs)
    return { summaries: result.summaries, skippedRuns: result.skipped }
  }

  async runSummary(runId: string): Promise<{ summary: RunSummary; skippedRuns: Array<{ id: string; reason: string }> }> {
    const { runs } = await this.runsList({})
    const run = runs.find((r) => r.id === runId)
    if (!run) throw new Error(`Run ${runId} not found in any linked repo — call axibridge_runs_list for valid ids.`)
    const { summaries, skippedRuns } = await this.summariesFor([run])
    if (summaries.length === 0) {
      throw new Error(`Run ${runId} could not be summarized: ${skippedRuns[0]?.reason ?? 'unknown'}`)
    }
    return { summary: summaries[0], skippedRuns }
  }

  async playerStats(args: DateRange & { accounts?: string[] }) {
    const { runs, errors } = await this.runsList(args)
    const { summaries, skippedRuns } = await this.summariesFor(runs)
    return { players: aggregatePlayers(summaries, args.accounts), runsConsidered: summaries.length, skippedRuns, errors }
  }

  /** Rollup-backed: published rollup.json when present, else computed locally. */
  private async rollupFor(repo: RepoRef): Promise<{ rollup: RollupData; source: 'published' | 'computed-locally' }> {
    const cached = this.deps.cache.readMeta(repo, 'rollup')
    if (cached) return JSON.parse(cached) as { rollup: RollupData; source: 'published' | 'computed-locally' }
    const published = await this.deps.client.fetchRollup(repo)
    let result: { rollup: RollupData; source: 'published' | 'computed-locally' }
    if (published) {
      result = { rollup: published.rollup, source: 'published' }
    } else {
      // Older repo without rollup.json — build it from full reports via bridge-metrics.
      const entries = await this.indexFor(repo)
      const sources: RollupReportPayload[] = []
      for (const entry of entries) {
        let body = this.deps.cache.readReport(repo, entry.id)
        if (!body) {
          body = JSON.stringify(await this.deps.client.fetchReport(repo, entry.id))
          this.deps.cache.putReport(repo, entry.id, body)
        }
        sources.push(extractRollupSource(JSON.parse(body) as RollupReportPayload))
      }
      result = { rollup: buildRollupData(sources), source: 'computed-locally' }
    }
    this.deps.cache.putMeta(repo, 'rollup', JSON.stringify(result))
    return result
  }

  async attendance(args: DateRange) {
    const rows: RollupData['playerRows'] = []
    let rollupSource: 'published' | 'computed-locally' = 'published'
    for (const repo of this.requireRepos()) {
      const { rollup, source } = await this.rollupFor(repo)
      if (source === 'computed-locally') rollupSource = source
      rows.push(...rollup.playerRows)
    }
    return { attendance: rows, rollupSource, range: args }
  }

  async commanderStats(args: DateRange) {
    const rows: RollupData['commanderRows'] = []
    let rollupSource: 'published' | 'computed-locally' = 'published'
    for (const repo of this.requireRepos()) {
      const { rollup, source } = await this.rollupFor(repo)
      if (source === 'computed-locally') rollupSource = source
      rows.push(...rollup.commanderRows)
    }
    return { commanders: rows, rollupSource, range: args }
  }

  /** a/b are run ids or date ranges "YYYY-MM-DD..YYYY-MM-DD". */
  async compare(a: string, b: string) {
    const resolve = async (spec: string): Promise<RunSummary[]> => {
      const rangeMatch = spec.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/)
      const { runs } = await this.runsList(
        rangeMatch ? { from: rangeMatch[1], to: rangeMatch[2] } : {}
      )
      const selected = rangeMatch ? runs : runs.filter((r) => r.id === spec)
      if (selected.length === 0) throw new Error(`No runs match "${spec}" — pass a run id from axibridge_runs_list or a range YYYY-MM-DD..YYYY-MM-DD.`)
      return (await this.summariesFor(selected)).summaries
    }
    const [setA, setB] = await Promise.all([resolve(a), resolve(b)])
    return { a, b, runsA: setA.length, runsB: setB.length, comparison: compareRunSets(setA, setB) }
  }
}
