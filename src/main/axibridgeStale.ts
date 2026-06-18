//
// Pure helpers for surfacing AxiBridge stale-cache age. The cache stores
// fetchedAt as epoch ms; the agent wants a precise ISO timestamp (staleSince)
// and the badge wants a short relative age (staleAge). foldStale aggregates
// per-repo staleness across a multi-repo loop, keeping the OLDEST known age.

/** Epoch ms → ISO. null/<= 0 (unknown) → null. */
export function staleSinceIso(fetchedAt: number | null): string | null {
  if (fetchedAt === null || fetchedAt <= 0) return null
  return new Date(fetchedAt).toISOString()
}

/** ISO → short relative age ("just now" / "Nm ago" / "Nh ago" / "Nd ago").
 *  null or unparseable → null. `now` injectable for tests. */
export function relativeAge(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const s = Math.max(0, Math.floor((now - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export interface StaleAgg {
  stale: boolean
  /** Oldest known (> 0) fetchedAt across stale repos; null when none knowable. */
  oldest: number | null
}

export const emptyStaleAgg: StaleAgg = { stale: false, oldest: null }

/** Fold one repo's stale state into the running aggregate. Fresh repos are
 *  ignored; a stale repo with a non-positive fetchedAt still flips `stale`. */
export function foldStale(agg: StaleAgg, stale: boolean, fetchedAt: number | null): StaleAgg {
  if (!stale) return agg
  const oldest =
    fetchedAt !== null && fetchedAt > 0
      ? agg.oldest === null
        ? fetchedAt
        : Math.min(agg.oldest, fetchedAt)
      : agg.oldest
  return { stale: true, oldest }
}
