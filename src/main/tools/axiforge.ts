import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, type ToolDeps } from './shared'
import { AxiforgeNotRunningError } from '../axiforgeClient'

/** Tools here that join the top-level DESTRUCTIVE_TOOLS list (deletes + public publishes). */
export const AXIFORGE_DESTRUCTIVE_TOOLS = [
  'axiforge_builds_delete',
  'axiforge_comps_delete',
  'axiforge_build_publish',
  'axiforge_comp_publish'
]

// NOTE: get/save results are plain compact JSON for now. Rich `build-card` /
// `comp-card` display payloads attach here once the rendering plan extends
// the tool-result AgentEvent with a `display` field (spec section 6).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxiforgeTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  // Auto-spawn-on-write: mutations hit the API; if AxiForge is closed, start it
  // headless and retry exactly once. ensureRunning's failures are friendly
  // AxiforgeErrors, which safe() turns into isError text — never thrown upward.
  const write = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
      await deps.axiforgeLauncher.ensureRunning()
      return fn()
    }
  }

  const folderNames = async (): Promise<Map<string, string>> =>
    new Map((await deps.axiforge.listFolders()).map((f) => [f.id, f.name]))

  return [
    tool(
      'axiforge_builds_list',
      'List builds stored in the local AxiForge app: id, title, profession, tags, folder, last updated. Works even when AxiForge is closed (reads its files directly).',
      {},
      safe(async () => {
        const [builds, folders] = await Promise.all([deps.axiforge.listBuilds(), folderNames()])
        return builds.map((b) => ({
          id: b.id,
          title: b.title,
          profession: b.profession,
          tags: b.tags ?? [],
          folder: b.folderId ? (folders.get(b.folderId) ?? b.folderId) : null,
          updatedAt: b.updatedAt ?? null
        }))
      })
    ),
    tool(
      'axiforge_builds_get',
      'Fetch one full AxiForge build by id (traits, skills, equipment, notes). Works even when AxiForge is closed.',
      { build_id: z.string().describe('Build id from axiforge_builds_list') },
      safe(async ({ build_id }) => deps.axiforge.getBuild(build_id))
    ),
    tool(
      'axiforge_builds_save',
      'Create or update a build in the local AxiForge app. Pass the FULL build object — to edit, get the build first, modify the returned object, and save it back; omit id to create. Starts AxiForge headless automatically if it is closed. Ground every skill/trait/gear choice in axiforge_catalog first.',
      { build: z.record(z.string(), z.unknown()).describe('Full build object (AxiForge build shape)') },
      safe(async ({ build }) => write(() => deps.axiforge.saveBuild(build)))
    ),
    tool(
      'axiforge_builds_delete',
      'Permanently delete a build from the local AxiForge app. This is destructive — the user will be asked to confirm before it runs.',
      { build_id: z.string().describe('Id of the build to delete') },
      safe(async ({ build_id }) => {
        await write(() => deps.axiforge.deleteBuild(build_id))
        return { deleted: build_id }
      })
    ),
    tool(
      'axiforge_comps_list',
      'List squad compositions stored in the local AxiForge app: id, title, folder, last updated. Works even when AxiForge is closed.',
      {},
      safe(async () => {
        const [comps, folders] = await Promise.all([deps.axiforge.listComps(), folderNames()])
        return comps.map((c) => ({
          id: c.id,
          title: c.title ?? c.name ?? 'Untitled Comp',
          folder: c.folderId ? (folders.get(c.folderId) ?? c.folderId) : null,
          updatedAt: c.updatedAt ?? null
        }))
      })
    ),
    tool(
      'axiforge_comps_get',
      'Fetch one full AxiForge squad composition by id. Works even when AxiForge is closed.',
      { comp_id: z.string().describe('Comp id from axiforge_comps_list') },
      safe(async ({ comp_id }) => deps.axiforge.getComp(comp_id))
    ),
    tool(
      'axiforge_comps_save',
      'Create or update a squad composition in the local AxiForge app. Pass the FULL comp object — to edit, get the comp first, modify it, save it back; omit id to create. Starts AxiForge headless automatically if it is closed.',
      { comp: z.record(z.string(), z.unknown()).describe('Full comp object (AxiForge comp shape)') },
      safe(async ({ comp }) => write(() => deps.axiforge.saveComp(comp)))
    ),
    tool(
      'axiforge_comps_delete',
      'Permanently delete a squad composition from the local AxiForge app. This is destructive — the user will be asked to confirm before it runs.',
      { comp_id: z.string().describe('Id of the comp to delete') },
      safe(async ({ comp_id }) => {
        await write(() => deps.axiforge.deleteComp(comp_id))
        return { deleted: comp_id }
      })
    ),
    tool(
      'axiforge_build_publish',
      'Publish an AxiForge build PUBLICLY and return its share URL. This is destructive (public) — the user will be asked to confirm before it runs.',
      { build_id: z.string().describe('Id of the build to publish') },
      safe(async ({ build_id }) => write(() => deps.axiforge.publishBuild(build_id)))
    ),
    tool(
      'axiforge_comp_publish',
      'Publish an AxiForge squad composition PUBLICLY and return its share URL. This is destructive (public) — the user will be asked to confirm before it runs.',
      { comp_id: z.string().describe('Id of the comp to publish') },
      safe(async ({ comp_id }) => write(() => deps.axiforge.publishComp(comp_id)))
    ),
    tool(
      'axiforge_import_chat_link',
      'Import an in-game build template chat code (e.g. [&DQE…]) into AxiForge as a new build. Starts AxiForge headless automatically if it is closed.',
      { chat_code: z.string().describe('Build template chat code, e.g. [&DQE...]') },
      safe(async ({ chat_code }) => write(() => deps.axiforge.importChatLink(chat_code)))
    ),
    tool(
      'axiforge_import_gw2skills',
      'Import a gw2skills.net editor link into AxiForge as a new build. Starts AxiForge headless automatically if it is closed.',
      { url: z.string().describe('gw2skills.net editor URL') },
      safe(async ({ url }) => write(() => deps.axiforge.importGw2skills(url)))
    ),
    tool(
      'axiforge_catalog',
      'Look up current GW2 profession/specialization/trait/skill/upgrade data from AxiForge’s catalog. ALWAYS ground build edits in this (and gw2_api) instead of memory — balance patches invalidate training data. kind "professions" lists all professions; "profession" needs profession_id (e.g. Guardian) and optional game_mode (pve/wvw/pvp) for its full spec/trait/skill data; "upgrades" lists runes/sigils/relics.',
      {
        kind: z.enum(['professions', 'profession', 'upgrades']).describe('Which catalog lookup to run'),
        profession_id: z.string().optional().describe('Profession id, e.g. Guardian (kind "profession")'),
        game_mode: z.string().optional().describe('pve, wvw, or pvp (kind "profession")')
      },
      safe(async ({ kind, profession_id, game_mode }) => {
        if (kind === 'professions') return deps.axiforge.catalogProfessions()
        if (kind === 'upgrades') return deps.axiforge.catalogUpgrades()
        if (!profession_id) throw new Error('kind "profession" requires profession_id')
        return deps.axiforge.catalogProfession(profession_id, game_mode)
      })
    )
  ]
}
