import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, safeRich, type ToolDeps } from './shared'
import { AxiforgeError, AxiforgeNotRunningError } from '../axiforgeClient'

/** Tools here that join the top-level DESTRUCTIVE_TOOLS list (deletes + public publishes). */
export const AXIFORGE_DESTRUCTIVE_TOOLS = [
  'axiforge_builds_delete',
  'axiforge_comps_delete',
  'axiforge_build_publish',
  'axiforge_comp_publish'
]

// get/save tools attach rich `build-card` / `comp-card` display payloads via
// safeRich(): the model sees compact (image-stripped) JSON; the renderer gets
// the full record — including images — for card visuals.

/**
 * Strip base64 image data from a build before returning it to the model.
 * Images are megabytes of data the model cannot use or modify; preserving them
 * in context wastes tokens and risks corruption. The imageKeys field tells the
 * model which image slots exist so it can inform the user.
 */
function stripImages(build: Record<string, unknown>): Record<string, unknown> {
  const images = build.images
  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    return build
  }
  const imageKeys = Object.keys(images as Record<string, unknown>)
  if (imageKeys.length === 0) return build
  return {
    ...build,
    images: undefined,
    imageKeys
  }
}

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
      try {
        return await fn()
      } catch (retryErr) {
        if (retryErr instanceof AxiforgeNotRunningError) {
          throw new AxiforgeError(
            'AxiForge was started but the operation still failed — try again, or open AxiForge manually.'
          )
        }
        throw retryErr
      }
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
      'Fetch one full AxiForge build by id (traits, skills, equipment, notes). Works even when AxiForge is closed. The user sees a rich build card for this result. Images are stripped from the response (they are megabytes of base64 data the model cannot use); imageKeys lists which image slots exist. Images are preserved automatically on save.',
      { build_id: z.string().describe('Build id from axiforge_builds_list') },
      safeRich(async ({ build_id }) => {
        const build = (await deps.axiforge.getBuild(build_id)) as Record<string, unknown>
        // Model gets the image-stripped build; the card renders the full one.
        return {
          value: stripImages(build),
          display: { kind: 'build-card', data: { build } }
        }
      })
    ),
    tool(
      'axiforge_builds_save',
      'Create or update a build in the local AxiForge app. Pass the FULL build object — to edit, get the build first, modify the returned object, and save it back; omit id to create. Starts AxiForge headless automatically if it is closed. Ground every skill/trait/gear choice in axiforge_catalog first. Images are preserved automatically on update — this tool cannot add or modify images. Returns compact echo: { id, title, updatedAt }. The user sees a rich build card for the saved build.',
      { build: z.record(z.string(), z.unknown()).describe('Full build object (AxiForge build shape); images are ignored — stored images are preserved automatically') },
      safeRich(async ({ build }) => {
        // On update, always re-attach stored images — model cannot modify images.
        let buildToSave = build
        if (typeof build.id === 'string' && build.id) {
          const stored = await deps.axiforge.getBuild(build.id).catch(() => null)
          if (stored && typeof stored === 'object') {
            const storedImages = (stored as Record<string, unknown>).images
            if (storedImages && typeof storedImages === 'object' && !Array.isArray(storedImages)) {
              buildToSave = { ...build, images: storedImages }
            }
          }
        }
        const saved = await write(() => deps.axiforge.saveBuild(buildToSave))
        const s = saved as Record<string, unknown>
        // Model echo stays compact; the card gets the full normalized build
        // the server echoed back from the save.
        return {
          value: { id: s.id, title: s.title, updatedAt: s.updatedAt ?? null },
          display: { kind: 'build-card', data: { build: s } }
        }
      })
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
      'Fetch one full AxiForge squad composition by id. Works even when AxiForge is closed. The user sees a rich comp card for this result.',
      { comp_id: z.string().describe('Comp id from axiforge_comps_list') },
      safeRich(async ({ comp_id }) => {
        const comp = (await deps.axiforge.getComp(comp_id)) as Record<string, unknown>
        // Embed the referenced builds so the card can render each slot. Any
        // failure here only degrades the display — the comp value still returns.
        try {
          const fromParty = ((comp.partyLines ?? []) as Array<{ slots?: unknown[] }>).flatMap(
            (l) => l.slots ?? []
          )
          const fromIds = Array.isArray(comp.buildIds) ? (comp.buildIds as unknown[]) : []
          const ids = [...new Set([...fromParty, ...fromIds])].filter(
            (x): x is string => typeof x === 'string' && x !== ''
          )
          const builds: Record<string, Record<string, unknown>> = {}
          await Promise.all(
            ids.map(async (buildId) => {
              try {
                builds[buildId] = (await deps.axiforge.getBuild(buildId)) as Record<string, unknown>
              } catch {
                /* missing builds render as placeholder cards */
              }
            })
          )
          return { value: comp, display: { kind: 'comp-card', data: { comp, builds } } }
        } catch {
          return { value: comp }
        }
      })
    ),
    tool(
      'axiforge_comps_save',
      'Create or update a squad composition in the local AxiForge app. Pass the FULL comp object — to edit, get the comp first, modify it, save it back; omit id to create. Starts AxiForge headless automatically if it is closed. Comp shape: { name, notes, tags, folderId, gameMode ("pve"|"wvw"), partyLines: [{ id, capacity, slots: [buildId, ...] }], buildIds: [buildId, ...] } — slots and buildIds reference build IDs from axiforge_builds_list. Returns compact echo: { id, name, updatedAt }.',
      { comp: z.record(z.string(), z.unknown()).describe('Full comp object (AxiForge comp shape)') },
      safe(async ({ comp }) => {
        const saved = await write(() => deps.axiforge.saveComp(comp))
        const s = saved as Record<string, unknown>
        return { id: s.id, name: s.name, updatedAt: s.updatedAt ?? null }
      })
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
      'gw2skills_parse',
      'Decode a gw2skills.net editor link into a structured build WITHOUT saving it — use this to explain, critique, or compare a build the user pasted. Returns the full build (profession, traits, skills, gear, runes/sigils/infusions, food, relic). Read-only; nothing is written to AxiForge. To actually rebuild the link in AxiForge instead, use axiforge_import_gw2skills. Parsing needs AxiForge\'s catalog, so it starts AxiForge headless if it is closed. The user sees a build card for the parsed build; images (if any) are stripped from the model-visible JSON.',
      {
        url: z.string().describe('gw2skills.net editor URL'),
        game_mode: z
          .enum(['pve', 'wvw', 'pvp'])
          .optional()
          .describe('Fallback game mode if the link does not specify one (the link usually does)')
      },
      safeRich(async ({ url, game_mode }) => {
        const build = (await write(() =>
          deps.axiforge.parseGw2Skills(game_mode ? { url, gameMode: game_mode } : { url })
        )) as Record<string, unknown>
        // Model gets the image-stripped build; the card renders the full one.
        return {
          value: stripImages(build),
          display: { kind: 'build-card', data: { build } }
        }
      })
    ),
    tool(
      'gw2_build_card',
      'Render the exact build card for a meta build from its in-game build template chat code ([&...]). Pass a chat code you found in meta_search results (MetaBattle build pages embed them). Decodes it WITHOUT saving and shows a build card; place it inline with a {{figure}} marker to illustrate a specific recommended build. Read-only.',
      {
        chat_code: z.string().describe('In-game build template chat code, e.g. [&DQ...]'),
        game_mode: z
          .enum(['pve', 'wvw', 'pvp'])
          .optional()
          .describe('Fallback game mode for stat context (optional)')
      },
      safeRich(async ({ chat_code, game_mode }) => {
        const build = (await write(() =>
          deps.axiforge.parseChatLink(game_mode ? { link: chat_code, gameMode: game_mode } : { link: chat_code })
        )) as Record<string, unknown>
        return {
          value: stripImages(build),
          display: { kind: 'build-card', data: { build } }
        }
      })
    ),
    tool(
      'axiforge_build_chat_link',
      'Generate the in-game build template chat code for an AxiForge build. The user can paste this code in Guild Wars 2 to load the build, or into gw2skills.net to view it. Read-only. Returns { chatLink }.',
      { build_id: z.string().describe('Build id from axiforge_builds_list') },
      safe(async ({ build_id }) => write(() => deps.axiforge.buildChatLink(build_id)))
    ),
    tool(
      'axiforge_catalog',
      'Look up current GW2 profession/specialization/trait/skill/upgrade data from AxiForge’s catalog. ALWAYS ground build edits in this (and gw2_api) instead of memory — balance patches invalidate training data. kind "professions" lists all professions; "profession" needs profession_id (e.g. Guardian) and optional game_mode (pve/wvw/pvp) for its full spec/trait/skill data; "upgrades" lists runes/sigils/relics.',
      {
        kind: z.enum(['professions', 'profession', 'upgrades']).describe('Which catalog lookup to run'),
        profession_id: z.string().optional().describe('Profession id, e.g. Guardian (kind "profession")'),
        game_mode: z.enum(['pve', 'wvw', 'pvp']).optional().describe('pve, wvw, or pvp (kind "profession")')
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
