// Section registry over axilog's `blocks`. Same descriptor shape as
// axibridgeSections.ts so the two read as one idiom — the difference is the
// source format: axilog keys every statistic by entity id under
// `blocks.<name>.by_entity`, so every shape() resolves ids through EntityIndex
// and never emits a bare id.
//
// A section result is a table and nothing else: {rows, columns, note?,
// warnings?}. The parsed report never leaves the worker, so no shaper may
// return a report fragment, a nested object, or an array — every cell is a
// string or a number.
//
// Coverage honesty runs deeper than the `coverage` map: a block can be
// `present` and still cover only part of the roster (in the WvW fixture
// `defenses` and `contribution` carry the 42 friendly entities and no enemies
// at all). Zero matching rows is therefore reported as a note explaining what
// the block covers, never as a silent empty table and never as a summed zero.

import {
  buildEntityIndex,
  type AxilogReport,
  type EntityIndex,
  type EntityRef,
  type EntityRole
} from './axilogEntities'
import type { PassFlags } from './axilogWorker'

export type Granularity = 'entity' | 'squad'
export const DEFAULT_ROW_LIMIT = 25

export interface SectionField {
  key: string
  label: string
  help?: string
  /**
   * How the squad granularity collapses this column. Totals sum; rates must not
   * (38 players' dps summed is a ~40k number that means nothing). Default 'sum'.
   */
  aggregate?: 'sum' | 'mean' | 'none'
}

export interface SectionQuery {
  granularity?: Granularity
  /** Loose name/account of a single entity to filter to; resolved via EntityIndex. */
  entity?: string
  role?: EntityRole
  subgroup?: number
  /** Column key to sort by, descending. Defaults to the descriptor's first metric. */
  sort?: string
  limit?: number
}

export interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string
  warnings?: string[]
}

export interface SectionDescriptor {
  key: string
  title: string
  aliases: string[]
  summary: string
  /** The `blocks.<name>` this reads; drives the coverage check. */
  block: string
  /** Parse passes this section needs beyond the default set. */
  passes: PassFlags
  granularities: Granularity[]
  fields: SectionField[]
  shape(report: AxilogReport, index: EntityIndex, opts: SectionQuery): SectionResult
}

/** Identity columns every entity-granular section leads with. */
const IDENTITY_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'profession', label: 'Spec' },
  { key: 'subgroup', label: 'Sub' }
]

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Round to one decimal — axilog emits full-precision floats for dps. */
const round1 = (v: number): number => Math.round(v * 10) / 10

/** Reads `obj.a.b`-style paths without dragging in a dependency. */
const nested = (obj: Record<string, unknown>, outer: string, inner: string): number =>
  num((obj[outer] as Record<string, unknown> | undefined)?.[inner])

const joinNotes = (...parts: Array<string | undefined>): string | undefined =>
  parts.filter(Boolean).join(' ') || undefined

function matchesFilters(ref: EntityRef, opts: SectionQuery, only: EntityRef | null): boolean {
  if (only && ref.id !== only.id) return false
  if (opts.role && ref.role !== opts.role) return false
  if (opts.subgroup !== undefined && ref.subgroup !== opts.subgroup) return false
  return true
}

/** Human-readable echo of the active filters, for the "matched nothing" note. */
function describeFilters(opts: SectionQuery, only: EntityRef | null): string {
  const parts: string[] = []
  if (only) parts.push(`entity=${only.name}`)
  if (opts.role) parts.push(`role=${opts.role}`)
  if (opts.subgroup !== undefined) parts.push(`subgroup=${opts.subgroup}`)
  return parts.join(', ')
}

/**
 * Validates a requested sort key against a field list and falls back rather
 * than silently no-op-sorting: an unrecognized key must never reach
 * `Array.sort` unnoticed, or every row compares equal and the caller believes
 * it got a sorted result when it got iteration order. Shared by every shaper
 * so this check can't drift out of sync between them.
 */
function resolveSortKey(
  fields: SectionField[],
  sort: string | undefined,
  defaultKey: string = fields[0].key
): { sortKey: string; note?: string } {
  const metricKeys = fields.map((f) => f.key)
  const sortKey = sort && metricKeys.includes(sort) ? sort : defaultKey
  const note =
    sort && !metricKeys.includes(sort)
      ? `Unknown sort key "${sort}"; sorted by ${sortKey} instead.`
      : undefined
  return { sortKey, note }
}

/**
 * Collapses a group of rows into one aggregated row for the given fields:
 * sum by default, mean for rate/percentage fields (never sum a percentage
 * across entities), '—' for fields marked 'none'. Shared by every
 * squad-granularity rollup for the same reason as `resolveSortKey`.
 */
function aggregateFields(
  rows: Array<Record<string, string | number>>,
  fields: SectionField[]
): { values: Record<string, string | number>; meanLabels: string[] } {
  const values: Record<string, string | number> = {}
  const meanLabels: string[] = []
  for (const f of fields) {
    if (f.aggregate === 'none') {
      values[f.key] = '—'
      continue
    }
    const sum = rows.reduce((acc, r) => acc + num(r[f.key]), 0)
    if (f.aggregate === 'mean') {
      values[f.key] = round1(sum / rows.length)
      meanLabels.push(f.label)
    } else {
      values[f.key] = round1(sum)
    }
  }
  return { values, meanLabels }
}

/**
 * The shared entity-granular shaper: walk `by_entity`, resolve each id, project
 * the descriptor's metrics, filter, sort, limit. Every entity section is this
 * plus a metric projection, which is why they stay a few lines each.
 */
function shapeByEntity(
  report: AxilogReport,
  index: EntityIndex,
  opts: SectionQuery,
  descriptor: SectionDescriptor,
  project: (stats: Record<string, unknown>, ref: EntityRef) => Record<string, string | number>,
  extraNote?: string
): SectionResult {
  const coverage = report.coverage?.[descriptor.block]
  const byEntity = report.blocks?.[descriptor.block]?.by_entity
  if (!byEntity || coverage === 'not_computed' || coverage === 'unsupported') {
    return {
      rows: [],
      columns: [],
      note: `This log does not carry ${descriptor.title.toLowerCase()} (coverage: ${coverage ?? 'absent'}).`
    }
  }

  // Resolve `entity` once, through the Task 2 resolver, rather than demanding a
  // verbatim roster string: the caller is an LLM paraphrasing a chat message.
  let only: EntityRef | null = null
  if (opts.entity) {
    only = index.resolveName(opts.entity)
    if (!only) {
      return {
        rows: [],
        columns: [],
        note: `Could not resolve "${opts.entity}" to exactly one entity in this log. Use the exact character name or account handle from the overview.`
      }
    }
  }

  const warnings: string[] = []
  const rows: Array<Record<string, string | number>> = []
  for (const [id, stats] of Object.entries(byEntity)) {
    const ref = index.get(id)
    if (!ref) {
      warnings.push(`Skipped statistics for unresolved entity id ${id}.`)
      continue
    }
    if (!matchesFilters(ref, opts, only)) continue
    rows.push({
      name: ref.name,
      profession: ref.profession,
      subgroup: ref.subgroup ?? '',
      ...project((stats ?? {}) as Record<string, unknown>, ref)
    })
  }

  const columns = [
    ...IDENTITY_COLUMNS,
    ...descriptor.fields.map((f) => ({ key: f.key, label: f.label }))
  ]
  const warningsPart = warnings.length ? { warnings } : {}

  // `empty` is the ONE coverage state where reporting 0 is honest, so every
  // return path below must say the block was empty — a bare "0" with no such
  // statement reads as a real measurement. Computed once, here, so the three
  // paths cannot drift apart (which is exactly how this drifted from
  // boonsSection, which emits its equivalent note on all of its paths).
  const emptyNote =
    coverage === 'empty' ? 'This block is present but empty for this fight.' : undefined

  // A `present` block can still cover only part of the roster, so "no rows" is
  // a fact about this block's coverage and must be stated, not implied.
  if (rows.length === 0) {
    const filters = describeFilters(opts, only)
    const note = `No entities matched${filters ? ` (${filters})` : ''}. This block covers ${Object.keys(byEntity).length} of the log's ${index.all().length} entities.`
    return { rows: [], columns, note: joinNotes(note, emptyNote, extraNote), ...warningsPart }
  }

  if (opts.granularity === 'squad') {
    const { values, meanLabels } = aggregateFields(rows, descriptor.fields)
    const total: Record<string, string | number> = {
      name: `${rows.length} entities`,
      profession: '—',
      subgroup: '',
      ...values
    }
    return {
      rows: [total],
      columns,
      note: joinNotes(
        `Summed across ${rows.length} matching entities.`,
        meanLabels.length ? `${meanLabels.join(', ')} is a mean, not a sum.` : undefined,
        emptyNote,
        extraNote
      ),
      ...warningsPart
    }
  }

  const { sortKey, note: sortNote } = resolveSortKey(descriptor.fields, opts.sort)
  rows.sort((a, b) => num(b[sortKey]) - num(a[sortKey]))
  const limit = opts.limit ?? DEFAULT_ROW_LIMIT
  const limited = rows.slice(0, limit)

  const truncatedNote =
    rows.length > limited.length
      ? `Showing ${limited.length} of ${rows.length} rows (raise \`limit\` for more).`
      : undefined
  // Independent of truncation: a present-but-empty block that also truncates
  // must not lose its "empty" message.
  const note = joinNotes(sortNote, truncatedNote, emptyNote, extraNote)

  return { rows: limited, columns, ...(note ? { note } : {}), ...warningsPart }
}

const damageSection: SectionDescriptor = {
  key: 'damage',
  title: 'Damage output',
  aliases: ['dps', 'damage', 'damage out', 'damage done', 'who did the most damage', 'cleave',
    'pressure', 'downs', 'kills', 'top damage'],
  summary:
    'Per-entity outgoing damage, dps, damage taken, and downs/kills dealt. Filter with `role` for enemy-side output.',
  block: 'damage',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'total', label: 'Damage' },
    { key: 'dps', label: 'DPS', aggregate: 'mean' },
    { key: 'downs', label: 'Downs', help: 'enemies this entity downed' },
    { key: 'kills', label: 'Kills' },
    { key: 'taken', label: 'Damage taken' },
    { key: 'breakbar', label: 'Breakbar' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, damageSection, (s) => ({
      total: num(s.total),
      dps: round1(num(s.dps)),
      downs: num(s.downs_dealt),
      kills: num(s.kills_dealt),
      taken: num(s.taken),
      breakbar: round1(num(s.breakbar_damage_dealt))
    }))
  }
}

const defensesSection: SectionDescriptor = {
  key: 'defenses',
  title: 'Defenses',
  aliases: ['defense', 'defenses', 'damage taken', 'deaths', 'died', 'downed', 'survivability',
    'who died', 'strips taken', 'boons stripped off us', 'blocks', 'dodges', 'barrier'],
  summary:
    'Per-entity incoming damage, times downed and killed, boon strips taken, and mitigation counts. The receiving end of a fight.',
  block: 'defenses',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'damageTaken', label: 'Damage taken', help: 'from blocks.damage.taken, the same figure the damage section reports' },
    { key: 'downsTaken', label: 'Times downed' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'boonStripsTaken', label: 'Strips taken' },
    { key: 'barrierDamage', label: 'Absorbed by barrier' },
    { key: 'blocked', label: 'Blocked' },
    { key: 'evaded', label: 'Evaded' },
    { key: 'dodges', label: 'Dodges' }
  ],
  shape(report, index, opts) {
    // `blocks.defenses` has no total for incoming damage — it splits it by kind
    // (strike / condition / life-leech / power / barrier), and summing those
    // disagrees with `blocks.damage.taken` for 8 of the fixture's 42 entities.
    // `taken` is the authoritative figure and is what the damage section
    // publishes, so read it here too rather than surface a rival number.
    const damageByEntity =
      report.coverage?.damage === 'present' ? report.blocks?.damage?.by_entity : undefined
    return shapeByEntity(
      report,
      index,
      opts,
      defensesSection,
      (s, ref) => ({
        damageTaken: damageByEntity
          ? num((damageByEntity[ref.id] as Record<string, unknown> | undefined)?.taken)
          : '',
        downsTaken: num(s.downs_taken),
        deaths: num(s.deaths),
        boonStripsTaken: num(s.boon_strips_taken),
        barrierDamage: num(s.barrier_damage),
        blocked: num(s.blocked_count),
        evaded: num(s.evaded_count),
        dodges: num(s.dodge_count)
      }),
      damageByEntity
        ? undefined
        : 'Damage taken is blank: it comes from the damage block, which this log does not carry.'
    )
  }
}

const contributionSection: SectionDescriptor = {
  key: 'contribution',
  title: 'Down contribution',
  aliases: ['contribution', 'down contribution', 'down contrib', 'who set up the downs',
    'downed by', 'what downed us', 'cc contribution', 'strip contribution'],
  summary:
    'Per-entity contribution to enemies going down (damage / cc / strips / immob), and what downed this entity in turn.',
  block: 'contribution',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'downsContribDamage', label: 'Down contrib (dmg)' },
    { key: 'downsContribCc', label: 'Down contrib (cc)' },
    { key: 'downsContribStrips', label: 'Down contrib (strips)' },
    { key: 'downsContribImmob', label: 'Down contrib (immob)' },
    { key: 'downedByDamage', label: 'Downed by (dmg)' },
    { key: 'downedByCc', label: 'Downed by (cc)' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, contributionSection, (s) => ({
      downsContribDamage: nested(s, 'downs_contribution', 'damage'),
      downsContribCc: nested(s, 'downs_contribution', 'cc'),
      downsContribStrips: nested(s, 'downs_contribution', 'strips'),
      downsContribImmob: nested(s, 'downs_contribution', 'movement_impairing'),
      downedByDamage: nested(s, 'downed_by', 'damage'),
      downedByCc: nested(s, 'downed_by', 'cc')
    }))
  }
}

/** Duration fields in this module are milliseconds unless noted otherwise. */
const msToSec = (ms: unknown): number => Math.round(num(ms) / 100) / 10

const supportSection: SectionDescriptor = {
  key: 'support',
  title: 'Support output',
  aliases: [
    'support',
    'strips',
    'boon strips',
    'stripped',
    'cleanses',
    'condi cleanse',
    'cleansing',
    'resurrects',
    'rezzes',
    'how were our strips'
  ],
  summary:
    'Per-entity boon strips, condition cleanses, and resurrects, with strip duration alongside strip count.',
  block: 'support',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'strips', label: 'Strips' },
    {
      key: 'stripDurationSec',
      label: 'Strip dur (s)',
      help: 'boon duration removed, not just count'
    },
    { key: 'cleanses', label: 'Cleanses' },
    { key: 'cleansesSelf', label: 'Self cleanses' },
    { key: 'resurrects', label: 'Resurrects' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, supportSection, (s) => ({
      strips: num(s.strips),
      stripDurationSec: msToSec(s.strips_duration_ms),
      cleanses: num(s.cleanses),
      cleansesSelf: num(s.cleanses_self),
      resurrects: num(s.resurrects)
    }))
  }
}

const ccSection: SectionDescriptor = {
  key: 'cc',
  title: 'Crowd control',
  aliases: [
    'cc',
    'crowd control',
    'hard cc',
    'stuns',
    'pulls',
    'knockdowns',
    'stunbreaks',
    'breakbar',
    'lockdown'
  ],
  summary: 'Per-entity crowd control applied, in seconds, plus stun breaks used.',
  block: 'cc',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'ccSec', label: 'CC applied (s)' },
    { key: 'stunBreaks', label: 'Stun breaks' }
  ],
  shape(report, index, opts) {
    return shapeByEntity(report, index, opts, ccSection, (s) => ({
      ccSec: msToSec(s.applied_duration_ms),
      stunBreaks: num(s.stun_breaks)
    }))
  }
}

/**
 * Boons are one row PER ENTITY PER BOON rather than one row per entity: a
 * single wide row of 20 boon columns is unreadable in a chat table and
 * answers fewer questions than a filterable long form. That shape doesn't fit
 * `shapeByEntity`'s one-row-per-id contract, so this section walks
 * `by_entity` itself — but it reuses the same coverage gate, entity
 * resolution, and filtering rules so the two shapers stay in lockstep.
 *
 * `generation.squad_pct` is the only squad-generation figure the block
 * carries (there is no seconds-valued generation field), so `squadGenPct` is
 * a percentage and is averaged, not summed, at squad granularity.
 * `generation.squad_wasted`, when present, is already expressed in seconds
 * (values top out at ~47s against a ~49s encounter) — unlike every other
 * duration in this module it is not a `_ms` field. It is absent when zero.
 */
const boonsSection: SectionDescriptor = {
  key: 'boons',
  title: 'Boon generation and uptime',
  aliases: [
    'boons',
    'boon',
    'uptime',
    'stability',
    'stab',
    'quickness',
    'alacrity',
    'might',
    'fury',
    'protection',
    'resistance',
    'aegis',
    'who gave stability',
    'boon gen'
  ],
  summary:
    'Per-entity, per-boon generation and uptime. One row per entity per boon — filter with `sort` to rank a single metric.',
  block: 'boons',
  passes: {},
  granularities: ['entity', 'squad'],
  fields: [
    { key: 'boon', label: 'Boon', aggregate: 'none' },
    { key: 'uptimePct', label: 'Uptime %', aggregate: 'mean' },
    { key: 'squadGenPct', label: 'Squad gen %', aggregate: 'mean' },
    { key: 'wasteSec', label: 'Wasted (s)', help: 'absent in the source when zero' }
  ],
  shape(report, index, opts) {
    const coverage = report.coverage?.boons
    const byEntity = report.blocks?.boons?.by_entity
    if (!byEntity || coverage === 'not_computed' || coverage === 'unsupported') {
      return {
        rows: [],
        columns: [],
        note: `This log does not carry boon generation (coverage: ${coverage ?? 'absent'}).`
      }
    }

    let only: EntityRef | null = null
    if (opts.entity) {
      only = index.resolveName(opts.entity)
      if (!only) {
        return {
          rows: [],
          columns: [],
          note: `Could not resolve "${opts.entity}" to exactly one entity in this log. Use the exact character name or account handle from the overview.`
        }
      }
    }

    const catalog = report.catalogs?.buffs ?? {}
    const warnings: string[] = []
    const rows: Array<Record<string, string | number>> = []
    for (const [id, perBoon] of Object.entries(byEntity)) {
      const ref = index.get(id)
      if (!ref) {
        warnings.push(`Skipped statistics for unresolved entity id ${id}.`)
        continue
      }
      if (!matchesFilters(ref, opts, only)) continue
      for (const [buffId, stats] of Object.entries(
        (perBoon ?? {}) as Record<string, Record<string, unknown>>
      )) {
        const generation = (stats.generation ?? {}) as Record<string, unknown>
        rows.push({
          name: ref.name,
          profession: ref.profession,
          subgroup: ref.subgroup ?? '',
          boon: catalog[buffId]?.name ?? `buff#${buffId}`,
          uptimePct: round1(num(stats.uptime_pct)),
          squadGenPct: round1(num(generation.squad_pct)),
          wasteSec: round1(num(generation.squad_wasted))
        })
      }
    }

    const columns = [
      ...IDENTITY_COLUMNS,
      ...boonsSection.fields.map((f) => ({ key: f.key, label: f.label }))
    ]
    const warningsPart = warnings.length ? { warnings } : {}
    const emptyBlockNote =
      coverage === 'empty' ? 'This block is present but empty for this fight.' : undefined

    if (rows.length === 0) {
      const filters = describeFilters(opts, only)
      const note = `No entities matched${filters ? ` (${filters})` : ''}. This block covers ${Object.keys(byEntity).length} of the log's ${index.all().length} entities.`
      return { rows: [], columns, note: joinNotes(note, emptyBlockNote), ...warningsPart }
    }

    // Squad granularity for a per-entity-per-boon table means one row PER
    // BOON, aggregated across the matching entities — not one row per entity
    // (that's the entity granularity above it) and not a single flattened
    // total (a mean stability uptime and a mean might uptime averaged
    // together would be meaningless). Group by the already-resolved boon
    // name and reuse the same `aggregateFields` every other section's squad
    // rollup uses, so mean-marked fields stay means here too.
    if (opts.granularity === 'squad') {
      const groups = new Map<string, Array<Record<string, string | number>>>()
      for (const row of rows) {
        const key = String(row.boon)
        const group = groups.get(key)
        if (group) group.push(row)
        else groups.set(key, [row])
      }
      const perBoonFields = boonsSection.fields.filter((f) => f.key !== 'boon')
      let meanLabels: string[] = []
      const aggregated: Array<Record<string, string | number>> = []
      for (const [boon, groupRows] of groups) {
        const { values, meanLabels: labels } = aggregateFields(groupRows, perBoonFields)
        meanLabels = labels
        aggregated.push({
          name: `${groupRows.length} entities`,
          profession: '—',
          subgroup: '',
          boon,
          ...values
        })
      }
      const { sortKey, note: sortNote } = resolveSortKey(
        boonsSection.fields,
        opts.sort,
        'squadGenPct'
      )
      aggregated.sort((a, b) => num(b[sortKey]) - num(a[sortKey]))
      const limit = opts.limit ?? DEFAULT_ROW_LIMIT
      const limited = aggregated.slice(0, limit)
      const note = joinNotes(
        `Aggregated across ${rows.length} matching entity-boon rows, one row per boon (${aggregated.length} boons).`,
        meanLabels.length ? `${meanLabels.join(', ')} is a mean, not a sum.` : undefined,
        sortNote,
        aggregated.length > limited.length
          ? `Showing ${limited.length} of ${aggregated.length} boons (raise \`limit\` for more).`
          : undefined,
        emptyBlockNote
      )
      return { rows: limited, columns, note, ...warningsPart }
    }

    const { sortKey, note: sortNote } = resolveSortKey(boonsSection.fields, opts.sort, 'squadGenPct')
    rows.sort((a, b) => num(b[sortKey]) - num(a[sortKey]))
    const limit = opts.limit ?? DEFAULT_ROW_LIMIT
    const limited = rows.slice(0, limit)
    const truncatedNote =
      rows.length > limited.length
        ? `Showing ${limited.length} of ${rows.length} entity-boon rows (raise \`limit\`, or set \`entity\` to focus one player).`
        : undefined
    const note = joinNotes(sortNote, truncatedNote, emptyBlockNote)

    return { rows: limited, columns, ...(note ? { note } : {}), ...warningsPart }
  }
}

export const SECTIONS: SectionDescriptor[] = [
  damageSection,
  defensesSection,
  contributionSection,
  supportSection,
  boonsSection,
  ccSection
]

export const getSection = (key: string): SectionDescriptor | undefined =>
  SECTIONS.find((s) => s.key === key)

/**
 * Free-text discovery over the registry. Empty / no match -> full catalog.
 * Always returns a fresh array: a caller that sorts or splices the result must
 * not mutate the process-wide registry.
 */
export function findSections(query: string): SectionDescriptor[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SECTIONS]
  const tokens = q.split(/\s+/).filter(Boolean)
  const scored = SECTIONS.map((s) => {
    const aliasSet = new Set([s.key, ...s.aliases].map((a) => a.toLowerCase()))
    const hay = [s.key, s.title, ...s.aliases, ...s.fields.map((f) => f.label)]
      .join(' ')
      .toLowerCase()
    let score = 0
    if (aliasSet.has(q)) score += 20
    if (hay.includes(q)) score += 10
    for (const t of tokens) {
      if (aliasSet.has(t)) score += 3
      else if (hay.includes(t)) score += 1
    }
    return { s, score }
  })
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  return hits.length ? hits.map((x) => x.s) : [...SECTIONS]
}

export function runSection(
  report: AxilogReport,
  section: string,
  opts: SectionQuery
): SectionResult {
  const descriptor = getSection(section)
  if (!descriptor) {
    throw new Error(
      `Unknown section "${section}". Known sections: ${SECTIONS.map((s) => s.key).join(', ')}.`
    )
  }
  return descriptor.shape(report, buildEntityIndex(report), opts)
}
