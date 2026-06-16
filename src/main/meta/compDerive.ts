// src/main/meta/compDerive.ts
//
// Pure aggregator: roll a pool of AxiBridge report comp-slices into a DerivedComp
// (profession mix, support ratio, modal subgroup). No I/O — the runner fetches
// reports and feeds slices here, so this is fully fixture-testable.

export interface ReportComp {
  squadClassData: Array<{ name: string; value: number }>
  roleClassifications: Array<{ profession: string; role: string }>
  /** Representative fight: each party is a list of professions. */
  parties: string[][]
}

export interface DerivedProfession {
  name: string
  avgPerSquad: number
  presencePct: number
  runAs: 'support' | 'damage' | 'mixed'
}

export interface DerivedComp {
  window: { fromISO: string; toISO: string; days: number }
  sampleSize: number
  sourceRepos: string[]
  lowConfidence: boolean
  avgSquadSize: number
  supportPct: number
  professions: DerivedProfession[]
  subgroup: { core: string[]; flex: string[] }
}

const MIN_SAMPLE = 3
const round1 = (n: number): number => Math.round(n * 10) / 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractReportComp(raw: any): ReportComp | null {
  const s = raw?.stats
  if (!s || !Array.isArray(s.squadClassData) || !Array.isArray(s.roleClassifications)) return null
  // Representative fight = the one with the most players across its parties.
  let best: string[][] = []
  let bestN = -1
  for (const f of Array.isArray(s.squadCompByFight) ? s.squadCompByFight : []) {
    const parties = (Array.isArray(f?.parties) ? f.parties : []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => (Array.isArray(p?.players) ? p.players : []).map((pl: any) => String(pl?.profession ?? '')).filter(Boolean)
    )
    const n = parties.reduce((a: number, p: string[]) => a + p.length, 0)
    if (n > bestN) {
      bestN = n
      best = parties
    }
  }
  return {
    squadClassData: s.squadClassData.map((d: { name: string; value: number }) => ({ name: String(d.name), value: Number(d.value) || 0 })),
    roleClassifications: s.roleClassifications.map((r: { profession: string; role: string }) => ({ profession: String(r.profession), role: String(r.role) })),
    parties: best
  }
}

export function compDerive(
  reports: ReportComp[],
  opts: { repos: string[]; days: number; fromISO: string; toISO: string }
): DerivedComp {
  const base: DerivedComp = {
    window: { fromISO: opts.fromISO, toISO: opts.toISO, days: opts.days },
    sampleSize: reports.length,
    sourceRepos: opts.repos,
    lowConfidence: reports.length < MIN_SAMPLE,
    avgSquadSize: 0,
    supportPct: 0,
    professions: [],
    subgroup: { core: [], flex: [] }
  }
  if (reports.length === 0) return base

  // Squad size = total headcount per report (sum of squadClassData values).
  const squadSizes = reports.map((r) => r.squadClassData.reduce((a, d) => a + d.value, 0))
  base.avgSquadSize = Math.round(squadSizes.reduce((a, b) => a + b, 0) / reports.length)

  // Support ratio across every classified player in the pool.
  let sup = 0
  let dmg = 0
  for (const r of reports)
    for (const rc of r.roleClassifications) {
      if (rc.role === 'support') sup++
      else if (rc.role === 'damage') dmg++
    }
  base.supportPct = sup + dmg === 0 ? 0 : Math.round((100 * sup) / (sup + dmg))

  // Per-profession totals, presence, and role lean.
  const total: Record<string, number> = {}
  const presence: Record<string, number> = {}
  const roleLean: Record<string, { support: number; damage: number }> = {}
  for (const r of reports) {
    for (const d of r.squadClassData) {
      total[d.name] = (total[d.name] ?? 0) + d.value
      presence[d.name] = (presence[d.name] ?? 0) + 1
    }
    for (const rc of r.roleClassifications) {
      const l = (roleLean[rc.profession] = roleLean[rc.profession] ?? { support: 0, damage: 0 })
      if (rc.role === 'support') l.support++
      else if (rc.role === 'damage') l.damage++
    }
  }
  base.professions = Object.keys(total)
    .map((name) => {
      const l = roleLean[name] ?? { support: 0, damage: 0 }
      const runAs: DerivedProfession['runAs'] =
        l.support === l.damage ? 'mixed' : l.support > l.damage ? 'support' : 'damage'
      return {
        name,
        avgPerSquad: round1(total[name] / reports.length),
        presencePct: Math.round((100 * presence[name]) / reports.length),
        runAs
      }
    })
    .sort((a, b) => b.avgPerSquad - a.avgPerSquad)

  // Subgroup: across all 5-player parties, core = profession appearing in >50% of them.
  const fives = reports.flatMap((r) => r.parties.filter((p) => p.length === 5))
  if (fives.length > 0) {
    const partyPresence: Record<string, number> = {}
    for (const party of fives) for (const prof of new Set(party)) partyPresence[prof] = (partyPresence[prof] ?? 0) + 1
    const core: string[] = []
    const flex: string[] = []
    for (const [prof, count] of Object.entries(partyPresence)) {
      const pct = count / fives.length
      // strict majority of 5-player parties = core; the rest (>=15%) = flex
      if (pct > 0.5) core.push(prof)
      else if (pct >= 0.15) flex.push(prof)
    }
    base.subgroup = { core, flex }
  }
  return base
}
