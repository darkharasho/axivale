// src/main/axibridgeSections.ts
export type Granularity = 'player' | 'category' | 'squad'

export interface SectionField { key: string; label: string; help?: string }
export interface SectionQuery {
  granularity?: Granularity
  account?: string
  boon?: string
  limit?: number
}
export interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string
  warnings?: string[]
}
export interface ParsedReport {
  meta?: Record<string, unknown>
  stats?: Record<string, unknown>
}
export interface SectionDescriptor {
  key: string
  title: string
  aliases: string[]
  summary: string
  granularities: Granularity[]
  fields: SectionField[]
  shape(report: ParsedReport, opts: SectionQuery): SectionResult
}

/** ms -> seconds, 1 decimal. */
export const secondsFromMs = (ms: number): number => Math.round((Number(ms) || 0) / 100) / 10
/** numerator/denominator as a 0–100 percentage, 1 decimal; 0 when denom is 0. */
const pct = (num: number, denom: number): number =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0

type BoonCat = { generationMs?: number; wastedMs?: number }
interface BoonRow {
  account: string
  profession: string
  professionList?: string[]
  activeTimeMs: number
  numFights: number
  groupSupported: number
  squadSupported: number
  categories: Record<'selfBuffs' | 'groupBuffs' | 'squadBuffs', BoonCat>
}
interface BoonTable { id: string; name: string; stacking: boolean; rows: BoonRow[] }

const boonsSection: SectionDescriptor = {
  key: 'boons',
  title: 'Boon generation',
  aliases: ['boon', 'boons', 'boon uptime', 'boon generation', 'boon waste', 'wasted boons',
    'might', 'fury', 'quickness', 'alacrity', 'protection', 'stability', 'resistance',
    'regeneration', 'aegis', 'swiftness', 'vigor', 'resolution', 'who gave', 'uptime'],
  summary: 'Per-player boon generation, waste, and uptime, split by self / group / squad. Filter to one boon with `boon`.',
  granularities: ['player', 'category', 'squad'],
  fields: [
    { key: 'boon', label: 'Boon' },
    { key: 'selfGenSec', label: 'Self gen (s)', help: 'self-only boon generation' },
    { key: 'groupGenSec', label: 'Group gen (s)', help: 'generation to own subgroup' },
    { key: 'squadGenSec', label: 'Squad gen (s)', help: 'generation across the squad' },
    { key: 'groupWasteSec', label: 'Group waste (s)', help: 'overcapped/wasted group generation' },
    { key: 'groupUptimePct', label: 'Group uptime %', help: 'groupGen / activeTime' }
  ],
  shape(report, opts) {
    const tables = (report.stats?.boonTables as BoonTable[] | undefined) ?? []
    if (tables.length === 0) {
      return { rows: [], columns: [], note: 'This report did not include boonTables.' }
    }
    const wanted = opts.boon?.toLowerCase()
    const selected = wanted ? tables.filter((t) => t.name.toLowerCase() === wanted) : tables
    if (wanted && selected.length === 0) {
      return {
        rows: [], columns: [],
        note: `No boon named "${opts.boon}". Available: ${tables.map((t) => t.name).join(', ')}.`
      }
    }

    const columns = [
      { key: 'account', label: 'Account' },
      { key: 'profession', label: 'Profession' },
      { key: 'boon', label: 'Boon' },
      { key: 'selfGenSec', label: 'Self gen (s)' },
      { key: 'groupGenSec', label: 'Group gen (s)' },
      { key: 'squadGenSec', label: 'Squad gen (s)' },
      { key: 'groupWasteSec', label: 'Group waste (s)' },
      { key: 'groupUptimePct', label: 'Group uptime %' }
    ]

    const perAccount: Array<Record<string, string | number>> = []
    for (const table of selected) {
      for (const row of table.rows ?? []) {
        if (opts.account && row.account !== opts.account) continue
        const c = row.categories ?? ({} as BoonRow['categories'])
        perAccount.push({
          account: row.account,
          profession: row.profession,
          boon: table.name,
          selfGenSec: secondsFromMs(c.selfBuffs?.generationMs ?? 0),
          groupGenSec: secondsFromMs(c.groupBuffs?.generationMs ?? 0),
          squadGenSec: secondsFromMs(c.squadBuffs?.generationMs ?? 0),
          groupWasteSec: secondsFromMs(c.groupBuffs?.wastedMs ?? 0),
          groupUptimePct: pct(c.groupBuffs?.generationMs ?? 0, row.activeTimeMs || 0)
        })
      }
    }

    if (opts.granularity === 'squad') {
      const sum = (k: keyof (typeof perAccount)[number]) =>
        perAccount.reduce((acc, r) => acc + (Number(r[k]) || 0), 0)
      return {
        rows: [{
          scope: 'squad total',
          boon: wanted ? selected[0].name : 'all boons',
          selfGenSec: Math.round(sum('selfGenSec') * 10) / 10,
          groupGenSec: Math.round(sum('groupGenSec') * 10) / 10,
          squadGenSec: Math.round(sum('squadGenSec') * 10) / 10,
          groupWasteSec: Math.round(sum('groupWasteSec') * 10) / 10
        }],
        columns: [
          { key: 'scope', label: 'Scope' },
          { key: 'boon', label: 'Boon' },
          { key: 'selfGenSec', label: 'Self gen (s)' },
          { key: 'groupGenSec', label: 'Group gen (s)' },
          { key: 'squadGenSec', label: 'Squad gen (s)' },
          { key: 'groupWasteSec', label: 'Group waste (s)' }
        ],
        note: 'Squad totals summed across players. Self/group/squad are the available granularity axes; party-number breakdown is not in the published data.'
      }
    }

    const limited = opts.limit ? perAccount.slice(0, opts.limit) : perAccount
    return {
      rows: limited,
      columns,
      note: wanted ? undefined : 'Multiple boons returned; pass `boon` to focus one. Uptime/waste are group-category figures.'
    }
  }
}

export const SECTIONS: SectionDescriptor[] = [boonsSection]

export const getSection = (key: string): SectionDescriptor | undefined =>
  SECTIONS.find((s) => s.key === key)
