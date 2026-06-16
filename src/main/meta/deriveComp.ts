// src/main/meta/deriveComp.ts
//
// Orchestrates a comp derivation: fetch each linked repo's index, keep reports in
// the last N days, fetch them, extract comp slices, and roll up via compDerive.
// Client is injected (a slice of AxibridgeClient) so it is testable without I/O.

import type { RepoRef } from '../axibridgeRepos'
import { repoKey } from '../axibridgeRepos'
import { compDerive, extractReportComp, type DerivedComp } from './compDerive'

export interface CompClientLike {
  fetchIndex(repo: RepoRef): Promise<Array<{ id: string; dateStart: string | null }>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchReport(repo: RepoRef, id: string): Promise<any>
}

export async function deriveCompFromRepos(
  client: CompClientLike,
  repos: RepoRef[],
  opts: { now: number; days: number }
): Promise<DerivedComp | null> {
  const cutoff = opts.now - opts.days * 86_400_000
  const fromISO = new Date(cutoff).toISOString().slice(0, 10)
  const toISO = new Date(opts.now).toISOString().slice(0, 10)
  const slices = []
  const usedRepos: string[] = []
  for (const repo of repos) {
    try {
      const index = await client.fetchIndex(repo)
      const recent = index.filter((e) => e.dateStart && Date.parse(e.dateStart) >= cutoff && Date.parse(e.dateStart) <= opts.now)
      if (recent.length === 0) continue
      let contributed = 0
      for (const e of recent) {
        try {
          const raw = await client.fetchReport(repo, e.id)
          const rc = extractReportComp(raw)
          if (rc) {
            slices.push(rc)
            contributed++
          }
        } catch {
          /* one report failing is isolated */
        }
      }
      if (contributed > 0) usedRepos.push(repoKey(repo))
    } catch {
      /* one repo failing is isolated */
    }
  }
  if (slices.length === 0) return null
  return compDerive(slices, { repos: usedRepos, days: opts.days, fromISO, toISO })
}
