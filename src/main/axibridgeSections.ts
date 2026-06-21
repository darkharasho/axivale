// src/main/axibridgeSections.ts
export type Granularity = 'player' | 'category' | 'squad'

export interface SectionField { key: string; label: string; help?: string }
export interface SectionQuery {
  granularity?: Granularity
  account?: string
  boon?: string
  condition?: string
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

// --- generic per-player totals sections ------------------------------------
interface PlayerTotalsRow {
  account: string
  profession: string
  professionList?: string[]
  activeMs?: number
  totalFightMs?: number
}

/**
 * Shape a `<domain>Players` array whose rows carry a `<totalsKey>` object.
 * `fields` maps output column key -> the key inside the totals object.
 * When `totalsKey === '__row__'`, reads fields directly from the row itself.
 * Squad granularity collapses to one summed row.
 */
function shapePlayerTotals(
  rows: Array<PlayerTotalsRow & Record<string, unknown>> | undefined,
  totalsKey: string,
  fields: Array<{ key: string; label: string; from: string }>,
  opts: SectionQuery,
  absentNote: string
): SectionResult {
  if (!rows || rows.length === 0) return { rows: [], columns: [], note: absentNote }

  const mapRow = (r: PlayerTotalsRow & Record<string, unknown>): Record<string, string | number> => {
    const totals = totalsKey === '__row__'
      ? (r as Record<string, number>)
      : ((r[totalsKey] as Record<string, number>) ?? {})
    const out: Record<string, string | number> = { account: r.account, profession: r.profession }
    for (const f of fields) out[f.key] = Number(totals[f.from] ?? 0)
    return out
  }

  let mapped = rows.filter((r) => !opts.account || r.account === opts.account).map(mapRow)

  const columns = [
    { key: 'account', label: 'Account' },
    { key: 'profession', label: 'Profession' },
    ...fields.map((f) => ({ key: f.key, label: f.label }))
  ]

  if (opts.granularity === 'squad') {
    const total: Record<string, string | number> = { account: 'squad total', profession: '—' }
    for (const f of fields) total[f.key] = mapped.reduce((acc, r) => acc + (Number(r[f.key]) || 0), 0)
    return { rows: [total], columns }
  }

  if (opts.limit) mapped = mapped.slice(0, opts.limit)
  return { rows: mapped, columns }
}

function playerTotalsSection(
  key: string, title: string, aliases: string[], summary: string,
  statsKey: string, totalsKey: string,
  fields: Array<{ key: string; label: string; from: string; help?: string }>
): SectionDescriptor {
  return {
    key, title, aliases, summary,
    granularities: ['player', 'squad'],
    fields: fields.map((f) => ({ key: f.key, label: f.label, help: f.help })),
    shape: (report, opts) =>
      shapePlayerTotals(
        report.stats?.[statsKey] as Array<PlayerTotalsRow & Record<string, unknown>> | undefined,
        totalsKey, fields, opts,
        `This report did not include ${statsKey}.`
      )
  }
}

const mitigationSection = playerTotalsSection(
  'damage_mitigation', 'Damage mitigation',
  ['mitigation', 'blocks', 'blocked', 'evades', 'evaded', 'dodge', 'dodges', 'miss', 'missed',
    'invuln', 'invulned', 'block', 'avoidance', 'defense'],
  'Per-player active defense: blocks, evades, misses, dodges, invulns, interrupts.',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'blocked', label: 'Blocked', from: 'blockedCount' },
    { key: 'evaded', label: 'Evaded', from: 'evadedCount' },
    { key: 'missed', label: 'Missed', from: 'missedCount' },
    { key: 'dodged', label: 'Dodged', from: 'dodgeCount' },
    { key: 'invulned', label: 'Invulned', from: 'invulnedCount' },
    { key: 'interrupted', label: 'Interrupted', from: 'interruptedCount' }
  ]
)

const damageTakenSection = playerTotalsSection(
  'damage_taken', 'Damage taken',
  ['damage taken', 'incoming damage', 'tanked', 'damage received', 'barrier absorbed', 'downs taken', 'deaths'],
  'Per-player incoming damage split into power/condition, barrier absorbed, and down/dead counts.',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'damageTaken', label: 'Damage taken', from: 'damageTaken' },
    { key: 'powerTaken', label: 'Power taken', from: 'powerDamageTaken' },
    { key: 'condiTaken', label: 'Condi taken', from: 'conditionDamageTaken' },
    { key: 'barrierAbsorbed', label: 'Barrier absorbed', from: 'damageBarrier' },
    { key: 'downCount', label: 'Downs', from: 'downCount' },
    { key: 'deadCount', label: 'Deaths', from: 'deadCount' }
  ]
)

const cleansesSection = playerTotalsSection(
  'cleanses', 'Condition cleanses',
  ['cleanse', 'cleanses', 'condi cleanse', 'condition cleanse', 'clears', 'condi clear'],
  'Per-player condition cleanses (total and self) with cleanse time.',
  'supportPlayers', 'supportTotals',
  [
    { key: 'cleanses', label: 'Cleanses', from: 'condiCleanse' },
    { key: 'cleanseTimeMs', label: 'Cleanse time (ms)', from: 'condiCleanseTime' },
    { key: 'selfCleanses', label: 'Self cleanses', from: 'condiCleanseSelf' }
  ]
)

const stripsSection = playerTotalsSection(
  'strips', 'Boon strips',
  ['strip', 'strips', 'boon strip', 'boon removal', 'corrupt', 'rip', 'strip to down', 'down contribution from strips', 'stun break', 'stunbreak'],
  'Per-player boon strips, strip-to-down contribution, and stun-breaks.',
  'supportPlayers', 'supportTotals',
  [
    { key: 'boonStrips', label: 'Strips', from: 'boonStrips' },
    { key: 'stripTimeMs', label: 'Strip time (ms)', from: 'boonStripsTime' },
    { key: 'stripDownContribution', label: 'Strip→down contrib', from: 'boonStripDownContribution' },
    { key: 'stunBreaks', label: 'Stun breaks', from: 'stunBreak' }
  ]
)

const crowdControlSection = playerTotalsSection(
  'crowd_control', 'Crowd control (received)',
  ['cc', 'crowd control', 'received cc', 'stunned', 'hard cc', 'soft cc', 'disabled'],
  'Per-player crowd control received, plus downs and deaths taken. Stun-breaks are in the "strips" section.',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'receivedCC', label: 'CC received', from: 'receivedCrowdControl' },
    { key: 'downCount', label: 'Downs', from: 'downCount' },
    { key: 'deadCount', label: 'Deaths', from: 'deadCount' }
  ]
)

const healingSection: SectionDescriptor = {
  key: 'healing', title: 'Healing output',
  aliases: ['healing', 'heals', 'healer', 'hps', 'squad healing', 'group healing', 'self healing'],
  summary: 'Per-player healing split by self / group / squad / off-squad.',
  granularities: ['player', 'category', 'squad'],
  fields: [
    { key: 'healing', label: 'Total healing' },
    { key: 'squadHealing', label: 'Squad healing' },
    { key: 'groupHealing', label: 'Group healing' },
    { key: 'selfHealing', label: 'Self healing' },
    { key: 'offSquadHealing', label: 'Off-squad healing' }
  ],
  shape: (report, opts) =>
    shapePlayerTotals(
      report.stats?.healingPlayers as Array<PlayerTotalsRow & Record<string, unknown>> | undefined,
      'healingTotals',
      [
        { key: 'healing', label: 'Total healing', from: 'healing' },
        { key: 'squadHealing', label: 'Squad healing', from: 'squadHealing' },
        { key: 'groupHealing', label: 'Group healing', from: 'groupHealing' },
        { key: 'selfHealing', label: 'Self healing', from: 'selfHealing' },
        { key: 'offSquadHealing', label: 'Off-squad healing', from: 'offSquadHealing' }
      ],
      opts, 'This report did not include healingPlayers.'
    )
}

const barrierSection = playerTotalsSection(
  'barrier', 'Barrier',
  ['barrier', 'barriers', 'damage barrier', 'shielding', 'absorbed'],
  'Per-player barrier absorbed (incoming damage soaked by barrier).',
  'defensePlayers', 'defenseTotals',
  [
    { key: 'barrierAbsorbed', label: 'Barrier absorbed', from: 'damageBarrier' },
    { key: 'barrierHitCount', label: 'Barrier hits', from: 'damageBarrierCount' }
  ]
)

const downContribSection = playerTotalsSection(
  'down_contribution', 'Down contribution',
  ['down contribution', 'downs', 'down contrib', 'pressure', 'who downed'],
  'Per-player downs caused and down-contribution damage.',
  'offensePlayers', '__row__',
  [
    { key: 'downs', label: 'Downs', from: 'downs' },
    { key: 'downContribution', label: 'Down contrib', from: 'downContribution' }
  ]
)

// --- conditions sections ----------------------------------------------------
// AxiBridge publishes each `<dir>ConditionPlayers` row as
//   { account, profession, conditions: { <Name>: { applications, damage,
//     applicationsFromBuffs, uptimeMs, ... }, ... } }
// i.e. there is NO flat per-row total — totals must be summed across the nested
// `conditions` map. Damaging conditions (Burning, Torment, Bleeding, Poison,
// Confusion) carry direct `applications`/`damage`; non-damaging ones (Vuln,
// Chill, Cripple, Weakness, …) carry `applicationsFromBuffs` and uptime instead.
interface ConditionTotals {
  applications?: number
  damage?: number
  applicationsFromBuffs?: number
}
interface ConditionPlayerRow {
  account: string
  profession: string
  professionList?: string[]
  conditions?: Record<string, ConditionTotals>
}

const CONDITION_FIELDS: SectionField[] = [
  { key: 'applications', label: 'Applications', help: 'direct (skill) condition applications' },
  { key: 'buffApplications', label: 'Buff applications', help: 'applications tracked via buffs; covers non-damaging conditions (Vuln, Chill, …)' },
  { key: 'condiDamage', label: 'Condi damage' }
]

function conditionsSection(
  key: string, title: string, aliases: string[], summary: string, statsKey: string
): SectionDescriptor {
  return {
    key, title, aliases, summary,
    granularities: ['player', 'squad'],
    fields: CONDITION_FIELDS,
    shape(report, opts) {
      const rows = report.stats?.[statsKey] as ConditionPlayerRow[] | undefined
      if (!rows || rows.length === 0) {
        return { rows: [], columns: [], note: `This report did not include ${statsKey}.` }
      }

      // Canonical condition names across every player, for the optional filter.
      const available = new Map<string, string>()
      for (const r of rows) {
        for (const name of Object.keys(r.conditions ?? {})) {
          if (!available.has(name.toLowerCase())) available.set(name.toLowerCase(), name)
        }
      }
      const want = opts.condition?.trim().toLowerCase()
      if (want && !available.has(want)) {
        return {
          rows: [], columns: [],
          note: `No condition named "${opts.condition}". Available: ${[...available.values()].join(', ')}.`
        }
      }
      const canonical = want ? available.get(want)! : undefined

      const columns = [
        { key: 'account', label: 'Account' },
        { key: 'profession', label: 'Profession' },
        ...(canonical ? [{ key: 'condition', label: 'Condition' }] : []),
        ...CONDITION_FIELDS.map((f) => ({ key: f.key, label: f.label }))
      ]

      let mapped = rows
        .filter((r) => !opts.account || r.account === opts.account)
        .map((r) => {
          let applications = 0
          let buffApplications = 0
          let condiDamage = 0
          for (const [name, c] of Object.entries(r.conditions ?? {})) {
            if (want && name.toLowerCase() !== want) continue
            applications += Number(c?.applications) || 0
            buffApplications += Number(c?.applicationsFromBuffs) || 0
            condiDamage += Number(c?.damage) || 0
          }
          const out: Record<string, string | number> = { account: r.account, profession: r.profession }
          if (canonical) out.condition = canonical
          out.applications = applications
          out.buffApplications = buffApplications
          out.condiDamage = condiDamage
          return out
        })

      const note = canonical
        ? undefined
        : `Totals summed across all conditions — pass \`condition\` (e.g. ${[...available.values()].slice(0, 3).join(', ')}) to focus one. Damaging conditions populate Applications/Condi damage; non-damaging ones populate Buff applications.`

      if (opts.granularity === 'squad') {
        const total: Record<string, string | number> = { account: 'squad total', profession: '—' }
        if (canonical) total.condition = canonical
        for (const f of CONDITION_FIELDS) {
          total[f.key] = mapped.reduce((acc, r) => acc + (Number(r[f.key]) || 0), 0)
        }
        return { rows: [total], columns, note }
      }

      if (opts.limit) mapped = mapped.slice(0, opts.limit)
      return { rows: mapped, columns, note }
    }
  }
}

const conditionsOutSection = conditionsSection(
  'conditions_out', 'Outgoing conditions',
  ['conditions', 'outgoing conditions', 'condi', 'condition damage', 'condi applications', 'applications', 'condi pressure'],
  'Per-player outgoing condition applications and condition damage, summed across all conditions. Pass `condition` (e.g. "Torment") to focus one.',
  'outgoingConditionPlayers'
)

const conditionsInSection = conditionsSection(
  'conditions_in', 'Incoming conditions',
  ['incoming conditions', 'conditions taken', 'condi taken', 'condition pressure received'],
  'Per-player incoming condition applications and condition damage taken, summed across all conditions. Pass `condition` to focus one.',
  'incomingConditionPlayers'
)

const classDistributionSection: SectionDescriptor = {
  key: 'class_distribution', title: 'Class distribution',
  aliases: ['classes', 'class distribution', 'comp', 'composition', 'professions', 'spec count', 'roster'],
  summary: 'Squad class/spec counts for the run.',
  granularities: ['squad'],
  fields: [{ key: 'class', label: 'Class' }, { key: 'count', label: 'Count' }],
  shape(report) {
    const data = report.stats?.squadClassData as Array<{ name: string; value: number }> | undefined
    if (!data || data.length === 0) return { rows: [], columns: [], note: 'This report did not include squadClassData.' }
    return {
      rows: data.map((d) => ({ class: d.name, count: Number(d.value) || 0 })),
      columns: [{ key: 'class', label: 'Class' }, { key: 'count', label: 'Count' }]
    }
  }
}

const leaderboardsSection: SectionDescriptor = {
  key: 'leaderboards', title: 'Leaderboards',
  aliases: ['leaderboard', 'leaderboards', 'top', 'ranking', 'rankings', 'best', 'mvp', 'who is top'],
  summary: 'Published per-metric leaderboards (downContrib, barrier, healing, dodges, strips, cleanses, cc, stability, dps, damage, …).',
  granularities: ['squad'],
  fields: [
    { key: 'metric', label: 'Metric' },
    { key: 'rank', label: 'Rank' },
    { key: 'account', label: 'Account' },
    { key: 'value', label: 'Value' }
  ],
  shape(report, opts) {
    const lb = report.stats?.leaderboards as Record<string, Array<Record<string, unknown>>> | undefined
    if (!lb || Object.keys(lb).length === 0) return { rows: [], columns: [], note: 'This report did not include leaderboards.' }
    const rows: Array<Record<string, string | number>> = []
    for (const [metric, list] of Object.entries(lb)) {
      ;(list ?? []).forEach((entry, i) => {
        rows.push({
          metric, rank: i + 1,
          account: String(entry.account ?? entry.name ?? '—'),
          value: Number(entry.value ?? 0)
        })
      })
    }
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows
    return {
      rows: limited,
      columns: [
        { key: 'metric', label: 'Metric' },
        { key: 'rank', label: 'Rank' },
        { key: 'account', label: 'Account' },
        { key: 'value', label: 'Value' }
      ]
    }
  }
}

export const SECTIONS: SectionDescriptor[] = [
  boonsSection,
  mitigationSection,
  damageTakenSection,
  cleansesSection,
  stripsSection,
  crowdControlSection,
  healingSection,
  barrierSection,
  downContribSection,
  conditionsOutSection,
  conditionsInSection,
  classDistributionSection,
  leaderboardsSection
]

export const getSection = (key: string): SectionDescriptor | undefined =>
  SECTIONS.find((s) => s.key === key)

/** Free-text discovery over the registry. Empty / no match -> full catalog. */
export function findSections(query: string): SectionDescriptor[] {
  const q = query.trim().toLowerCase()
  if (!q) return SECTIONS
  const tokens = q.split(/\s+/).filter(Boolean)
  const scored = SECTIONS.map((s) => {
    const hay = [
      s.key, s.title, ...s.aliases,
      ...s.fields.map((f) => f.label), ...s.fields.map((f) => f.help ?? '')
    ].join(' ').toLowerCase()
    // whole-query substring is the strongest signal, then per-token hits
    let score = 0
    if (hay.includes(q)) score += 10
    for (const t of tokens) if (hay.includes(t)) score += 1
    return { s, score }
  })
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  return hits.length ? hits.map((x) => x.s) : SECTIONS
}
