import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, safeRich } from './shared'
import type { AxilogService } from '../axilogService'
import type { AxilogWatcher, LogEntry } from '../axilogWatcher'
import { findSections, getSection, DEFAULT_ROW_LIMIT } from '../axilogSections'

export interface AxilogDeps {
  watcher: AxilogWatcher
  /** null when the native module failed to load — every tool then errors kindly. */
  service: AxilogService | null
  /**
   * Called with the entry every time a tool touches a specific log, so the
   * conversation can persist the ref ({logId, path, label}) and still resolve
   * that fight after a relaunch. Metadata only — nothing parsed is recorded.
   * Optional so tests and non-conversation call sites can omit it.
   */
  onLogUsed?: (entry: LogEntry) => void
}

const SCHEMA_MAP =
  'Document shape: entities[] is the roster (roles: squad | friendly_player | enemy_player | npc); ' +
  'per-entity stats live at blocks.<name>.by_entity keyed by entities[].id AS STRINGS; ' +
  'names for skills/buffs/minions live in catalogs.<kind>[<id>].name; ' +
  'coverage maps each block to present | empty | not_computed | unsupported. ' +
  'There is no players[] and no schema_version.'

/** Resolve a logId to its registry entry and a live service, or throw for the model. */
function resolve(deps: AxilogDeps, logId: string): { entry: LogEntry; service: AxilogService } {
  if (!deps.service) {
    throw new Error(
      'AxiLog is not available on this install (the native parser failed to load) — see the Logs panel for details.'
    )
  }
  const entry = deps.watcher.resolve(logId)
  if (!entry) {
    // A ref this conversation used before, whose file has since disappeared:
    // say so explicitly. "Unknown log" would read as a lookup slip and invite
    // an answer from memory about a fight nothing can see any more. The label
    // (map + time), never the path, is what the model is given.
    const gone = deps.watcher.missingRef(logId)
    if (gone) {
      throw new Error(
        `The log file for "${gone.label}" is no longer on disk, so it cannot be analyzed. ` +
          'Tell the user the file is gone — do not answer about that fight from earlier context.'
      )
    }
    throw new Error(`Unknown log "${logId}". Call axilog_logs_list to see the available fights.`)
  }
  deps.onLogUsed?.(entry)
  return { entry, service: deps.service }
}

/**
 * AxiLog raw-log tools. All read-only: they parse a local arcdps log and return
 * shaped rows. One .zevtc is ONE FIGHT — night-level trends belong to the
 * axibridge_* family, not here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxilogTools(deps: () => AxilogDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'axilog_logs_list',
      'Recent arcdps fights available to analyze: watched folder plus any log the user opened. Filesystem only — nothing is parsed. Start here to turn "last fight" or "tonight" into a logId.',
      {
        since: z.string().optional().describe('ISO date/time floor, e.g. 2026-08-30T20:00:00'),
        limit: z.number().optional().describe('max fights to return (default 20)'),
        map: z.string().optional().describe('substring match on the map folder, e.g. "World vs World"')
      },
      safeRich(async (args: { since?: string; limit?: number; map?: string }) => {
        const d = deps()
        d.watcher.scan()
        const logs = d.watcher.list({ since: args.since, limit: args.limit ?? 20, map: args.map })
        return {
          value: {
            // PROJECTED, never the raw LogEntry: `path` is an absolute
            // filesystem path (home directory, OS account name) and this value
            // is serialized straight into the model's context and shipped to a
            // third-party inference API. The model addresses logs by `logId`;
            // main resolves the path itself in `resolve()`. Nothing downstream
            // needs it, so it must never be added back here.
            logs: logs.map(({ logId, startedAt, mapFolder, bytes, source }) => ({
              logId,
              startedAt,
              mapFolder,
              bytes,
              source
            })),
            note:
              logs.length === 0
                ? 'No logs found. The user may need to set the arcdps log folder in the Logs panel, or drop a .zevtc into the chat.'
                : undefined
          },
          display: {
            kind: 'table' as const,
            data: {
              title: 'Recent fights',
              columns: [
                { key: 'startedAt', label: 'Started' },
                { key: 'mapFolder', label: 'Map' },
                { key: 'sizeMb', label: 'Size (MB)' },
                { key: 'source', label: 'Source' }
              ],
              rows: logs.map((l) => ({
                startedAt: l.startedAt.replace('T', ' '),
                mapFolder: l.mapFolder,
                sizeMb: Math.round((l.bytes / 1024 / 1024) * 10) / 10,
                source: l.source
              }))
            }
          }
        }
      })
    ),

    tool(
      'axilog_fight_overview',
      'Parse a fight and return its encounter, team composition, squad roster, and COVERAGE. Call this first for any log. `coverage` is authoritative: a block marked not_computed or unsupported cannot be answered from this log — say so rather than guessing.',
      { logId: z.string().describe('from axilog_logs_list') },
      safe(async (args: { logId: string }) => {
        const { entry, service } = resolve(deps(), args.logId)
        return service.overview(entry.logId, entry.path)
      })
    ),

    tool(
      'axilog_sections_list',
      'The catalog of analysis sections a raw log exposes: keys, what each covers, and its columns. Pass `topic` to find the right section for a question ("strips", "who gave stability"). Roster coverage varies by section: `damage` is computed for a broader set of entities than `defenses`, `contribution`, `support`, `cc`, and `boons`, which are computed only for friendly entities — a query for an enemy role against those five comes back honestly EMPTY (never computed), not a real zero; each result\'s note reports the actual coverage for that log. This log format also never attributes minion damage to a specific enemy player.',
      { topic: z.string().optional() },
      safe(async (args: { topic?: string }) => ({
        sections: findSections(args.topic ?? '').map((s) => ({
          key: s.key,
          title: s.title,
          summary: s.summary,
          granularities: s.granularities,
          columns: s.fields.map((f) => ({ key: f.key, label: f.label, help: f.help }))
        }))
      }))
    ),

    tool(
      'axilog_section',
      'The workhorse: one analysis section of one fight, as named rows. Use `role` to separate your squad from the enemy, `entity` to focus one player, `sort` to rank by a column. Prefer this over axilog_query. Note: `defenses`, `contribution`, `support`, `cc`, and `boons` are computed only for friendly entities (squad/friendly_player), unlike `damage` which is computed for a broader set of entities including enemies — an enemy-role query against those five sections comes back honestly EMPTY (never computed), not a real zero; the result\'s note reports the actual coverage for that log. Minion damage cannot be attributed to a specific enemy player in this log format.',
      {
        logId: z.string(),
        section: z.string().describe('a key from axilog_sections_list'),
        granularity: z.enum(['entity', 'squad']).optional(),
        entity: z.string().optional().describe('exact character name or account to filter to'),
        role: z.enum(['squad', 'friendly_player', 'enemy_player', 'npc']).optional(),
        subgroup: z.number().optional(),
        sort: z.string().optional().describe('column key to rank by, descending'),
        limit: z.number().optional().describe(`rows to return (default ${DEFAULT_ROW_LIMIT})`)
      },
      safeRich(
        async (args: {
          logId: string
          section: string
          granularity?: 'entity' | 'squad'
          entity?: string
          role?: 'squad' | 'friendly_player' | 'enemy_player' | 'npc'
          subgroup?: number
          sort?: string
          limit?: number
        }) => {
          const { entry, service } = resolve(deps(), args.logId)
          const descriptor = getSection(args.section)
          if (!descriptor) {
            throw new Error(
              `Unknown section "${args.section}". Call axilog_sections_list to see what a log exposes.`
            )
          }
          const { logId: _l, section: _s, ...opts } = args
          const result = await service.section(
            entry.logId,
            entry.path,
            args.section,
            opts,
            descriptor.passes
          )
          return {
            value: result,
            display: result.rows.length
              ? {
                  kind: 'table' as const,
                  data: {
                    title: `${descriptor.title} — ${entry.mapFolder} ${entry.startedAt.replace('T', ' ')}`,
                    columns: result.columns,
                    rows: result.rows
                  }
                }
              : undefined
          }
        }
      )
    ),

    tool(
      'axilog_query',
      `Run a jq filter over a fight's raw axilog document, for questions no section covers. Output is capped and truncation is reported. ${SCHEMA_MAP}`,
      {
        logId: z.string(),
        filter: z.string().describe('a jq expression, e.g. .encounter.markers'),
        limit: z.number().optional().describe('max jq outputs to keep (default 50)')
      },
      safe(async (args: { logId: string; filter: string; limit?: number }) => {
        const { entry, service } = resolve(deps(), args.logId)
        const res = await service.query(entry.logId, entry.path, args.filter, args.limit ?? 50)
        // The worker may already have attached an entity-id note; keep it and
        // append the truncation warning rather than clobbering one with the other.
        const notes = [
          res.note,
          res.truncated
            ? 'Result truncated — narrow the filter rather than treating this as the complete answer.'
            : undefined
        ].filter(Boolean)
        return { ...res, note: notes.length ? notes.join(' ') : undefined }
      })
    )
  ]
}
