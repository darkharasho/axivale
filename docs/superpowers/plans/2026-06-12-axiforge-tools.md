# Axivale ⇄ AxiForge Client + Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AxiVale's agent first-class tools over the local AxiForge app — list/get/save/delete/publish builds and comps, chat-link/gw2skills imports, and catalog lookups — via a discovery-file-authenticated HTTP client with read-only file fallback, an auto-spawn headless launcher, destructive-tool confirmation, system-prompt grounding rules, and a Settings connection indicator.

**Working directory:** /var/home/mstephens/Documents/GitHub/axivale

**Architecture:** AxiForge (sibling Electron app) exposes a localhost HTTP API discovered via `<AxiForge userData>/data/local-api.json` (`{ port, token, exePath, version, pid }` — assumed to exist per the spec, section 1). AxiVale adds `src/main/axiforgeClient.ts` (modeled on `axitoolsClient.ts`) that distinguishes "not running" from request errors, falls back to direct read-only JSON file reads for builds/comps/folders, and persists catalog data to an AxiVale-side cache file after successful connections. `src/main/axiAppLauncher.ts` (TypeScript port of axiom's `electron/detect.ts` + the launch handler in `electron/ipc-handlers.ts`) resolves the AxiForge executable (discovery-file `exePath` first, then platform detection) and spawns it detached with `--headless` and a sanitized env, polling discovery + `/health` up to ~15s. `src/main/tools.ts` is split into `src/main/tools/{shared,axitools,discord,gw2,axiforge}.ts` with `src/main/tools/index.ts` exporting `buildOfficerTools()` unchanged in shape; new `axiforge_*` tools register there, with deletes and publishes added to `DESTRUCTIVE_TOOLS` so the existing confirm dialog (`src/main/providers/permission.ts`) covers them. Mutation tool handlers auto-spawn on "not running" and retry once; all failures surface as friendly error strings via the existing `safe()` wrapper, never as thrown exceptions to the provider.

**Note on `display` payloads:** the `tool-result` `AgentEvent` in `src/main/providers/types.ts` is currently `{ kind: 'tool-result'; id: string; isError: boolean; text: string }` — it does **not** support a `display` field. Per the spec's separation of concerns, `axiforge_builds_get`/`axiforge_builds_save`/`axiforge_comps_get`/`axiforge_comps_save` return plain compact JSON in this plan; attaching `build-card`/`comp-card` `display` payloads is wired in the separate rendering plan (spec section 6), which extends the `AgentEvent` type first.

**Tech Stack:** TypeScript (strict, `moduleResolution: "bundler"`), Electron 33 (electron-vite), zod v4, `@anthropic-ai/claude-agent-sdk` `tool()`, vitest 2 (`pool: forks`, max 2 workers per `vitest.config.ts` and global instructions), Node `http`/`fs`/`child_process` built-ins (no new dependencies).

---

## Task 1: Split `tools.ts` into `src/main/tools/*` modules (no behavior change)

The split is a pure move. All 24 existing tools keep their names, descriptions, schemas, and handler bodies verbatim. Importers (`agent.ts` uses `'./tools'`; `providers/permission.ts`, `providers/claude.ts`, `providers/toolSchema.test.ts` use `'../tools'`) need **no changes**: with `moduleResolution: "bundler"` and Vite/vitest resolution, those specifiers resolve to the new `src/main/tools/index.ts` once `src/main/tools.ts` is deleted. The existing `src/main/tools.test.ts` (27 tests) stays untouched and is the behavior guard.

**Files:**
- Create: `src/main/tools/shared.ts` (ToolDeps, ToolResult, `ok`, `safe`, `requireDiscordGuild`)
- Create: `src/main/tools/axitools.ts` (tool defs from `src/main/tools.ts` lines 100–191 and 224–386)
- Create: `src/main/tools/discord.ts` (tool defs from `src/main/tools.ts` lines 192–223, plus `DESTRUCTIVE_DISCORD_ACTIONS` from lines 22–31)
- Create: `src/main/tools/gw2.ts` (tool defs from `src/main/tools.ts` lines 388–438, plus the `resolveGw2Guild` helper from lines 89–97)
- Create: `src/main/tools/index.ts` (composition + `DESTRUCTIVE_TOOLS`/`ACTION_GATED_TOOLS` re-exports)
- Create: `src/main/tools/inventory.test.ts` (exact tool-name inventory snapshot)
- Delete: `src/main/tools.ts`
- Unchanged (verification only): `src/main/tools.test.ts`, `src/main/agent.ts:1`, `src/main/providers/permission.ts:2`, `src/main/providers/claude.ts:13`, `src/main/providers/toolSchema.test.ts:5`

**Steps:**

- [ ] Write the failing inventory test at `src/main/tools/inventory.test.ts`. It imports from `'./index'`, which does not exist yet:

```ts
import { describe, it, expect } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS, type ToolDeps } from './index'

const deps: ToolDeps = {
  axitools: {} as never,
  gw2: {} as never,
  discordGuildId: () => '1',
  gw2GuildId: () => 'g1'
}

describe('tools module split', () => {
  it('exposes exactly the pre-split tool inventory', () => {
    const names = buildOfficerTools(deps)
      .map((t) => t.name)
      .sort()
    expect(names).toEqual([
      'axitools_alliance',
      'axitools_audit',
      'axitools_builds_create',
      'axitools_builds_delete',
      'axitools_builds_list',
      'axitools_builds_update',
      'axitools_comp_presets_delete',
      'axitools_comp_presets_list',
      'axitools_comp_presets_save',
      'axitools_comp_schedules_list',
      'axitools_comp_schedules_save',
      'axitools_config',
      'axitools_guild_roles',
      'axitools_key_holders',
      'axitools_members',
      'axitools_rss',
      'axitools_streams',
      'discord_action',
      'discord_messages',
      'discord_overview',
      'gw2_account_info',
      'gw2_api',
      'gw2_guild_log',
      'gw2_guild_members'
    ])
  })

  it('keeps the destructive lists intact', () => {
    expect(DESTRUCTIVE_TOOLS).toEqual(['axitools_builds_delete', 'axitools_comp_presets_delete'])
    expect(ACTION_GATED_TOOLS).toEqual({
      discord_action: [
        'channel_delete',
        'role_update',
        'role_delete',
        'member_timeout',
        'member_kick',
        'member_ban',
        'member_dm',
        'members_dm'
      ],
      axitools_rss: ['delete'],
      axitools_streams: ['delete'],
      axitools_guild_roles: ['delete']
    })
  })
})
```

- [ ] Run it expecting failure (module `./index` not found):

```
npx vitest run --maxWorkers=2 src/main/tools/inventory.test.ts
```

- [ ] Create `src/main/tools/shared.ts`. This hoists the private helpers from `tools.ts` lines 6–13 (`ToolDeps`), 44–66 (`ToolResult`, `ok`, `safe`), and converts the `requireDiscordGuild` closure (`tools.ts` lines 83–87) into a function taking `deps`:

```ts
import type { AxitoolsClient } from '../axitoolsClient'
import type { Gw2Client } from '../gw2Client'

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  /** active Discord guild id from settings as a string — snowflakes overflow JS numbers ('' = unset) */
  discordGuildId: () => string
  /** active GW2 guild id from settings ('' = unset) */
  gw2GuildId: () => string
}

export interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

// Compact on purpose: results go into the model's context, where pretty-print
// indentation is pure token waste. The UI re-renders results humanized anyway.
export function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Wraps a handler so thrown errors come back as MCP error results instead of exceptions. */
export function safe<A>(fn: (args: A) => Promise<unknown>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}

export function requireDiscordGuild(deps: ToolDeps): string {
  const id = deps.discordGuildId()
  if (id === '') throw new Error('Discord guild not connected — save an AxiVale key in Settings (05)')
  return id
}
```

- [ ] Create `src/main/tools/axitools.ts`. Move the tool definitions verbatim from `src/main/tools.ts` lines 100–191 (`axitools_builds_list` through `axitools_comp_schedules_save`) and lines 224–386 (`axitools_audit` through `axitools_key_holders`) inside the function body below. The only mechanical edit: every `requireDiscordGuild()` call site becomes `requireDiscordGuild(deps)`. Module skeleton:

```ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, requireDiscordGuild, type ToolDeps } from './shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxitoolsTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    // …tools.ts lines 100–191 verbatim (9 tools: axitools_builds_list/create/update/delete,
    // axitools_comp_presets_list/save/delete, axitools_comp_schedules_list/save)…
    // …tools.ts lines 224–386 verbatim (8 tools: axitools_audit, axitools_rss,
    // axitools_streams, axitools_alliance, axitools_guild_roles, axitools_config,
    // axitools_members, axitools_key_holders)…
  ]
}
```

- [ ] Create `src/main/tools/discord.ts`. Move `DESTRUCTIVE_DISCORD_ACTIONS` (`tools.ts` lines 18–31, with its doc comment) and the three Discord tool definitions (`tools.ts` lines 192–223: `discord_overview`, `discord_messages`, `discord_action`) verbatim, again swapping `requireDiscordGuild()` → `requireDiscordGuild(deps)`:

```ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, requireDiscordGuild, type ToolDeps } from './shared'

/**
 * discord_action verbs that get the confirm dialog. Must mirror the
 * `destructive: True` entries in axitools' api/discord_actions.py registry.
 */
export const DESTRUCTIVE_DISCORD_ACTIONS = [
  'channel_delete',
  'role_update',
  'role_delete',
  'member_timeout',
  'member_kick',
  'member_ban',
  'member_dm',
  'members_dm'
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildDiscordTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    // …tools.ts lines 192–223 verbatim (discord_overview, discord_messages, discord_action —
    // discord_action's template-literal description keeps interpolating DESTRUCTIVE_DISCORD_ACTIONS)…
  ]
}
```

- [ ] Create `src/main/tools/gw2.ts`. Move the `resolveGw2Guild` closure (`tools.ts` lines 88–97) as a two-arg function, and the four GW2 tools (`tools.ts` lines 388–438) verbatim:

```ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, type ToolDeps } from './shared'

// Explicit guild_id wins; otherwise fall back to the configured guild.
function resolveGw2Guild(deps: ToolDeps, explicit?: string): string {
  if (explicit) return explicit
  const id = deps.gw2GuildId()
  if (id === '')
    throw new Error(
      'No guild_id given and no default guild configured — pass guild_id (your key’s guild ids come from gw2_account_info, or resolve a name via gw2_api /guild/search?name=…), or set a default in Settings (05)'
    )
  return id
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGw2Tools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    // …tools.ts lines 388–438 verbatim (gw2_api with its bespoke truncating handler,
    // gw2_account_info, gw2_guild_members, gw2_guild_log) — `resolveGw2Guild(guild_id)`
    // call sites become `resolveGw2Guild(deps, guild_id)`…
  ]
}
```

- [ ] Create `src/main/tools/index.ts` — the composition point. Public exports match the old `tools.ts` exactly (`buildOfficerTools`, `ToolDeps`, `DESTRUCTIVE_TOOLS`, `DESTRUCTIVE_DISCORD_ACTIONS`, `ACTION_GATED_TOOLS`); keep the original doc comment on `buildOfficerTools` (`tools.ts` lines 68–80):

```ts
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { ToolDeps } from './shared'
import { buildAxitoolsTools } from './axitools'
import { buildDiscordTools, DESTRUCTIVE_DISCORD_ACTIONS } from './discord'
import { buildGw2Tools } from './gw2'

export type { ToolDeps } from './shared'
export { DESTRUCTIVE_DISCORD_ACTIONS }

/** Tools that mutate data irreversibly — the UI asks the user to confirm before running these. */
export const DESTRUCTIVE_TOOLS = ['axitools_builds_delete', 'axitools_comp_presets_delete']

/**
 * Tools whose risk depends on their `action` input: never pre-allowed, and
 * the listed verbs require user confirmation.
 */
export const ACTION_GATED_TOOLS: Record<string, string[]> = {
  discord_action: DESTRUCTIVE_DISCORD_ACTIONS,
  axitools_rss: ['delete'],
  axitools_streams: ['delete'],
  axitools_guild_roles: ['delete']
}

// …original buildOfficerTools doc comment from tools.ts lines 68–80…
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOfficerTools(deps: ToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [...buildAxitoolsTools(deps), ...buildDiscordTools(deps), ...buildGw2Tools(deps)]
}
```

- [ ] Delete `src/main/tools.ts` (`rm src/main/tools.ts`). The specifiers `'./tools'` / `'../tools'` now resolve to `src/main/tools/index.ts`.
- [ ] Run the full suite and typecheck, expecting everything green — the untouched `src/main/tools.test.ts` proves no behavior change:

```
npx vitest run --maxWorkers=2
npm run typecheck
```

- [ ] Commit:

```
git add -A && git commit -m "refactor: split tools.ts into src/main/tools/* modules" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `src/main/axiforgeClient.ts` — discovery-file client with file fallback and catalog cache

Mirrors `src/main/axitoolsClient.ts` (single class, `request<T>` core, typed methods, error subclass) with three additions: discovery-file resolution per request (the port/token change every AxiForge launch), an `AxiforgeNotRunningError` subclass so callers can distinguish "not running" (missing/stale discovery file, connection refused) from real request errors (HTTP 4xx/5xx → plain `AxiforgeError`), read-only file fallback for builds/comps/folders list+get, and a persistent catalog cache written after every successful catalog fetch.

**Files:**
- Create: `src/main/axiforgeClient.ts`
- Create: `src/main/axiforgeClient.test.ts`

**Steps:**

- [ ] Write the failing test `src/main/axiforgeClient.test.ts` against a stub HTTP server and fixture files in a temp dir:

```ts
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AddressInfo } from 'net'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AxiforgeClient, AxiforgeNotRunningError, AxiforgeError, forgeDataDir } from './axiforgeClient'

const TOKEN = 'test-token-123'

const FIXTURE_BUILDS = [
  { id: 'b1', title: 'Heal Firebrand', profession: 'Guardian', tags: ['wvw', 'support'], folderId: 'f1', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'b2', title: 'Power Reaper', profession: 'Necromancer', tags: [], folderId: null, updatedAt: '2026-06-02T00:00:00.000Z' }
]
const FIXTURE_COMPS = [{ id: 'c1', name: 'Zerg Comp', folderId: null, updatedAt: '2026-06-03T00:00:00.000Z' }]
const FIXTURE_FOLDERS = [{ id: 'f1', name: 'WvW' }]

let dataDir: string
let cachePath: string
let server: Server | null = null
let requests: Array<{ method: string; url: string; auth: string | undefined; body: string }> = []

function startStub(routes: Record<string, { status?: number; json: unknown }>): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body })
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
        const route = routes[`${req.method} ${req.url}`]
        if (!route) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }
        res.writeHead(route.status ?? 200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(route.json))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port))
  })
}

function writeDiscovery(port: number): void {
  writeFileSync(
    join(dataDir, 'local-api.json'),
    JSON.stringify({ port, token: TOKEN, exePath: '/opt/AxiForge/axiforge', version: '1.4.0', pid: 4242 })
  )
}

function makeClient(): AxiforgeClient {
  return new AxiforgeClient({ dataDir, catalogCachePath: cachePath })
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'axiforge-data-'))
  cachePath = join(mkdtempSync(join(tmpdir(), 'axivale-cache-')), 'axiforge-catalog.json')
  requests = []
  writeFileSync(join(dataDir, 'builds.json'), JSON.stringify(FIXTURE_BUILDS))
  writeFileSync(join(dataDir, 'comps.json'), JSON.stringify(FIXTURE_COMPS))
  writeFileSync(join(dataDir, 'folders.json'), JSON.stringify(FIXTURE_FOLDERS))
})

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = null
  rmSync(dataDir, { recursive: true, force: true })
})

describe('forgeDataDir', () => {
  it('maps platforms to the AxiForge userData data dir', () => {
    expect(forgeDataDir('linux')).toMatch(/AxiForge\/data$/)
    expect(forgeDataDir('darwin')).toContain(join('Library', 'Application Support', 'AxiForge', 'data'))
    expect(forgeDataDir('win32')).toContain(join('AxiForge', 'data'))
  })
})

describe('API path', () => {
  it('sends the bearer token from the discovery file', async () => {
    const port = await startStub({ 'GET /builds': { json: FIXTURE_BUILDS } })
    writeDiscovery(port)
    const builds = await makeClient().listBuilds()
    expect(builds.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(requests[0].auth).toBe(`Bearer ${TOKEN}`)
  })

  it('saveBuild POSTs the body and returns the saved build', async () => {
    const port = await startStub({ 'POST /builds': { json: { ...FIXTURE_BUILDS[0], title: 'Renamed' } } })
    writeDiscovery(port)
    const saved = await makeClient().saveBuild({ id: 'b1', title: 'Renamed' })
    expect(saved.title).toBe('Renamed')
    expect(JSON.parse(requests[0].body)).toMatchObject({ id: 'b1', title: 'Renamed' })
  })

  it('HTTP errors surface as AxiforgeError with the server message, not NotRunning', async () => {
    const port = await startStub({ 'POST /builds': { status: 422, json: { error: 'profession is required' } } })
    writeDiscovery(port)
    const err = await makeClient().saveBuild({ title: 'bad' }).catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err).not.toBeInstanceOf(AxiforgeNotRunningError)
    expect(err.message).toBe('profession is required')
  })

  it('publishBuild hits the publish endpoint', async () => {
    const port = await startStub({ 'POST /builds/b1/publish': { json: { url: 'https://axiforge.app/b/heal-fb' } } })
    writeDiscovery(port)
    const res = await makeClient().publishBuild('b1')
    expect(res).toMatchObject({ url: 'https://axiforge.app/b/heal-fb' })
  })

  it('importChatLink and importGw2skills post to the import endpoints', async () => {
    const port = await startStub({
      'POST /import/chat-link': { json: { id: 'b9', title: 'Imported' } },
      'POST /import/gw2skills': { json: { id: 'b10', title: 'Imported 2' } }
    })
    writeDiscovery(port)
    const client = makeClient()
    await client.importChatLink('[&DQE...]')
    await client.importGw2skills('http://gw2skills.net/editor/?abc')
    expect(JSON.parse(requests[0].body)).toEqual({ chatLink: '[&DQE...]' })
    expect(JSON.parse(requests[1].body)).toEqual({ url: 'http://gw2skills.net/editor/?abc' })
  })
})

describe('not-running detection and file fallback', () => {
  it('missing discovery file: writes throw AxiforgeNotRunningError', async () => {
    await expect(makeClient().deleteBuild('b1')).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('stale discovery file (connection refused): writes throw AxiforgeNotRunningError', async () => {
    const port = await startStub({ 'GET /health': { json: { ok: true, version: '1.4.0' } } })
    writeDiscovery(port)
    await new Promise((r) => server!.close(r))
    server = null
    await expect(makeClient().saveBuild({ title: 'x' })).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('reads fall back to the JSON files when the API is unreachable', async () => {
    const client = makeClient()
    expect((await client.listBuilds()).map((b) => b.id)).toEqual(['b1', 'b2'])
    expect((await client.getBuild('b2')).title).toBe('Power Reaper')
    expect((await client.listComps()).map((c) => c.id)).toEqual(['c1'])
    expect((await client.getComp('c1')).name).toBe('Zerg Comp')
    expect(await client.listFolders()).toEqual(FIXTURE_FOLDERS)
  })

  it('getBuild on a missing id in fallback mode throws a plain AxiforgeError', async () => {
    const err = await makeClient().getBuild('nope').catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err).not.toBeInstanceOf(AxiforgeNotRunningError)
    expect(err.message).toContain('nope')
  })
})

describe('catalog cache', () => {
  it('caches catalog responses and serves them when the API is down', async () => {
    const professions = [{ id: 'Guardian', name: 'Guardian' }]
    const port = await startStub({ 'GET /catalog/professions': { json: professions } })
    writeDiscovery(port)
    const client = makeClient()
    expect(await client.catalogProfessions()).toEqual(professions)
    expect(existsSync(cachePath)).toBe(true)

    await new Promise((r) => server!.close(r))
    server = null
    unlinkSync(join(dataDir, 'local-api.json'))
    expect(await makeClient().catalogProfessions()).toEqual(professions)
  })

  it('catalog with no cache and no API throws AxiforgeNotRunningError', async () => {
    await expect(makeClient().catalogUpgrades()).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('catalogProfession caches per id and game mode', async () => {
    const port = await startStub({
      'GET /catalog/professions/Guardian?gameMode=wvw': { json: { id: 'Guardian', specializations: [] } }
    })
    writeDiscovery(port)
    await makeClient().catalogProfession('Guardian', 'wvw')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache.entries['profession:Guardian:wvw']).toMatchObject({ id: 'Guardian' })
  })
})

describe('status', () => {
  it('reports connected when /health responds', async () => {
    const port = await startStub({ 'GET /health': { json: { ok: true, version: '1.4.0' } } })
    writeDiscovery(port)
    expect(await makeClient().status()).toEqual({ state: 'connected', version: '1.4.0' })
  })

  it('reports file-only when the API is down but data files exist', async () => {
    expect(await makeClient().status()).toEqual({ state: 'file-only' })
  })

  it('reports offline when neither the API nor data files exist', async () => {
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
    expect(await makeClient().status()).toEqual({ state: 'offline' })
  })
})
```

- [ ] Run expecting failure (module does not exist):

```
npx vitest run --maxWorkers=2 src/main/axiforgeClient.test.ts
```

- [ ] Implement `src/main/axiforgeClient.ts`:

```ts
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'

export class AxiforgeError extends Error {}
export class AxiforgeNotRunningError extends AxiforgeError {
  constructor(message = 'AxiForge is not running on this machine.') {
    super(message)
  }
}

/** Contents of AxiForge's <userData>/data/local-api.json, written on every launch. */
export interface AxiforgeDiscovery {
  port: number
  token: string
  exePath: string
  version: string
  pid: number
}

export interface ForgeFolder {
  id: string
  name: string
}

/** Builds/comps are AxiForge-owned documents — known listing fields typed, the rest passed through. */
export interface ForgeBuild {
  [key: string]: unknown
  id: string
  title: string
  profession: string
  tags?: string[]
  folderId?: string | null
  updatedAt?: string
}

export interface ForgeComp {
  [key: string]: unknown
  id: string
  name?: string
  title?: string
  folderId?: string | null
  updatedAt?: string
}

export type AxiforgeStatus =
  | { state: 'connected'; version: string }
  | { state: 'file-only' }
  | { state: 'offline' }

/** AxiForge's <userData>/data dir per platform (productName "AxiForge"). */
export function forgeDataDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'AxiForge', 'data')
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'AxiForge', 'data')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'AxiForge', 'data')
}

export interface AxiforgeClientOptions {
  /** AxiForge's data dir: holds local-api.json, builds.json, comps.json, folders.json. */
  dataDir: string
  /** AxiVale-side file persisting catalog responses across AxiForge restarts. */
  catalogCachePath: string
}

interface CatalogCacheFile {
  entries: Record<string, unknown>
  savedAt: string
}

export class AxiforgeClient {
  constructor(private readonly opts: AxiforgeClientOptions) {}

  // --- discovery + transport ----------------------------------------------

  async readDiscovery(): Promise<AxiforgeDiscovery> {
    let raw: string
    try {
      raw = await readFile(join(this.opts.dataDir, 'local-api.json'), 'utf8')
    } catch {
      throw new AxiforgeNotRunningError()
    }
    try {
      const parsed = JSON.parse(raw) as AxiforgeDiscovery
      if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') {
        throw new Error('malformed')
      }
      return parsed
    } catch {
      throw new AxiforgeNotRunningError()
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const disc = await this.readDiscovery()
    let resp: Response
    try {
      resp = await fetch(`http://127.0.0.1:${disc.port}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${disc.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      // Connection refused with a discovery file present = the app crashed
      // without cleanup (stale file). Treat exactly like "closed".
      throw new AxiforgeNotRunningError()
    }
    if (resp.status === 204) return undefined as T
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new AxiforgeError(
        (data as { error?: string }).error ?? `AxiForge API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  // --- read-only file fallback (never writes; concurrent reads are safe) ---

  private async readJsonFile<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.opts.dataDir, name), 'utf8')) as T
    } catch {
      return null
    }
  }

  private async withFileFallback<T>(api: () => Promise<T>, file: () => Promise<T>): Promise<T> {
    try {
      return await api()
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
      return file()
    }
  }

  // --- builds ----------------------------------------------------------------

  listBuilds(): Promise<ForgeBuild[]> {
    return this.withFileFallback(
      () => this.request('GET', '/builds'),
      async () => (await this.readJsonFile<ForgeBuild[]>('builds.json')) ?? []
    )
  }

  getBuild(id: string): Promise<ForgeBuild> {
    return this.withFileFallback(
      () => this.request('GET', `/builds/${encodeURIComponent(id)}`),
      async () => {
        const build = ((await this.readJsonFile<ForgeBuild[]>('builds.json')) ?? []).find(
          (b) => b.id === id
        )
        if (!build) throw new AxiforgeError(`No AxiForge build with id "${id}".`)
        return build
      }
    )
  }

  saveBuild(build: Record<string, unknown>): Promise<ForgeBuild> {
    return this.request('POST', '/builds', build)
  }

  deleteBuild(id: string): Promise<void> {
    return this.request('DELETE', `/builds/${encodeURIComponent(id)}`)
  }

  publishBuild(id: string): Promise<unknown> {
    return this.request('POST', `/builds/${encodeURIComponent(id)}/publish`)
  }

  // --- comps -------------------------------------------------------------------

  listComps(): Promise<ForgeComp[]> {
    return this.withFileFallback(
      () => this.request('GET', '/comps'),
      async () => (await this.readJsonFile<ForgeComp[]>('comps.json')) ?? []
    )
  }

  getComp(id: string): Promise<ForgeComp> {
    return this.withFileFallback(
      () => this.request('GET', `/comps/${encodeURIComponent(id)}`),
      async () => {
        const comp = ((await this.readJsonFile<ForgeComp[]>('comps.json')) ?? []).find(
          (c) => c.id === id
        )
        if (!comp) throw new AxiforgeError(`No AxiForge comp with id "${id}".`)
        return comp
      }
    )
  }

  saveComp(comp: Record<string, unknown>): Promise<ForgeComp> {
    return this.request('POST', '/comps', comp)
  }

  deleteComp(id: string): Promise<void> {
    return this.request('DELETE', `/comps/${encodeURIComponent(id)}`)
  }

  publishComp(id: string): Promise<unknown> {
    return this.request('POST', `/comps/${encodeURIComponent(id)}/publish`)
  }

  // --- folders / imports --------------------------------------------------------

  listFolders(): Promise<ForgeFolder[]> {
    return this.withFileFallback(
      () => this.request('GET', '/folders'),
      async () => (await this.readJsonFile<ForgeFolder[]>('folders.json')) ?? []
    )
  }

  importChatLink(chatLink: string): Promise<ForgeBuild> {
    return this.request('POST', '/import/chat-link', { chatLink })
  }

  importGw2skills(url: string): Promise<ForgeBuild> {
    return this.request('POST', '/import/gw2skills', { url })
  }

  // --- catalog (persistent cache so cards/grounding work offline) ----------------

  private async readCatalogCache(): Promise<CatalogCacheFile> {
    try {
      return JSON.parse(await readFile(this.opts.catalogCachePath, 'utf8')) as CatalogCacheFile
    } catch {
      return { entries: {}, savedAt: '' }
    }
  }

  private async cachedCatalog<T>(cacheKey: string, path: string): Promise<T> {
    try {
      const data = await this.request<T>('GET', path)
      const cache = await this.readCatalogCache()
      cache.entries[cacheKey] = data
      cache.savedAt = new Date().toISOString()
      await mkdir(dirname(this.opts.catalogCachePath), { recursive: true })
      await writeFile(this.opts.catalogCachePath, JSON.stringify(cache))
      return data
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
      const cache = await this.readCatalogCache()
      if (cacheKey in cache.entries) return cache.entries[cacheKey] as T
      throw new AxiforgeNotRunningError(
        'AxiForge is not running and no cached catalog data exists yet — open AxiForge once to prime the cache.'
      )
    }
  }

  catalogProfessions(): Promise<unknown> {
    return this.cachedCatalog('professions', '/catalog/professions')
  }

  catalogProfession(id: string, gameMode?: string): Promise<unknown> {
    const qs = gameMode ? `?gameMode=${encodeURIComponent(gameMode)}` : ''
    return this.cachedCatalog(
      `profession:${id}:${gameMode ?? ''}`,
      `/catalog/professions/${encodeURIComponent(id)}${qs}`
    )
  }

  catalogUpgrades(): Promise<unknown> {
    return this.cachedCatalog('upgrades', '/catalog/upgrades')
  }

  // --- health / status ------------------------------------------------------------

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('GET', '/health')
  }

  /** Settings-indicator state: live API > readable files > nothing. */
  async status(): Promise<AxiforgeStatus> {
    try {
      const h = await this.health()
      return { state: 'connected', version: h.version }
    } catch {
      try {
        await access(join(this.opts.dataDir, 'builds.json'))
        return { state: 'file-only' }
      } catch {
        return { state: 'offline' }
      }
    }
  }
}
```

- [ ] Run expecting pass, then the full suite + typecheck:

```
npx vitest run --maxWorkers=2 src/main/axiforgeClient.test.ts
npx vitest run --maxWorkers=2
npm run typecheck
```

- [ ] Commit:

```
git add -A && git commit -m "feat: AxiforgeClient — discovery-file local API client with file fallback and catalog cache" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `src/main/axiAppLauncher.ts` — exe resolution + headless spawn + health polling

TypeScript port of axiom's `electron/detect.ts` (Windows registry query, Linux AppImage scan — axiom's `~/AppImages` location covers Gear Lever installs, whose `axiom-version`/metadata conventions only yield versions, not exe paths) and the launch portion of axiom's `electron/ipc-handlers.ts` lines 302–400 (registry `InstallLocation`/`DisplayIcon` exe resolution, sanitized child env, detached spawn, `systemd-run --user --scope` on Linux). Resolution order per spec: (1) `exePath` from the discovery file, (2) platform detection. I/O is injected for testability; defaults use real `child_process`/`fs`.

**Files:**
- Create: `src/main/axiAppLauncher.ts`
- Create: `src/main/axiAppLauncher.test.ts`
- Reference (port source, read-only): `/var/home/mstephens/Documents/GitHub/axiom/electron/detect.ts`, `/var/home/mstephens/Documents/GitHub/axiom/electron/ipc-handlers.ts:302-400`

**Steps:**

- [ ] Write the failing test `src/main/axiAppLauncher.test.ts`:

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AxiAppLauncher, resolveAxiforgeExe, type LauncherIo } from './axiAppLauncher'
import { AxiforgeNotRunningError, AxiforgeError } from './axiforgeClient'

let dataDir: string

function fakeIo(overrides: Partial<LauncherIo> = {}): LauncherIo {
  return {
    platform: 'linux',
    spawn: vi.fn().mockReturnValue({ on: vi.fn(), unref: vi.fn() }),
    execSync: vi.fn().mockReturnValue(''),
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockImplementation(() => {
      throw new Error('ENOENT')
    }),
    statSync: vi.fn(),
    hasSystemdRun: () => false,
    ...overrides
  } as LauncherIo
}

/** Client stub: health() fails `failures` times with NotRunning, then succeeds. */
function flakyClient(failures: number): { health: () => Promise<{ ok: boolean; version: string }> } {
  let calls = 0
  return {
    health: async () => {
      calls += 1
      if (calls <= failures) throw new AxiforgeNotRunningError()
      return { ok: true, version: '1.4.0' }
    }
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'axiforge-launch-'))
})
afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

describe('resolveAxiforgeExe', () => {
  it('prefers exePath from the discovery file when it exists on disk', () => {
    writeFileSync(
      join(dataDir, 'local-api.json'),
      JSON.stringify({ port: 1, token: 't', exePath: '/opt/AxiForge/axiforge', version: '1', pid: 1 })
    )
    const io = fakeIo({ existsSync: vi.fn().mockImplementation((p: string) => p === '/opt/AxiForge/axiforge') })
    expect(resolveAxiforgeExe(dataDir, io)).toBe('/opt/AxiForge/axiforge')
  })

  it('falls back to an AppImage filename scan on linux', () => {
    const io = fakeIo({
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage', 'other.txt'] : []
      )
    })
    expect(resolveAxiforgeExe(dataDir, io)).toMatch(/AppImages\/AxiForge-1\.4\.0\.AppImage$/)
  })

  it('on windows, resolves DisplayIcon exe from the registry query', () => {
    const io = fakeIo({
      platform: 'win32',
      execSync: vi
        .fn()
        .mockReturnValue('{"InstallLocation":"C:\\\\Apps\\\\AxiForge","DisplayIcon":"C:\\\\Apps\\\\AxiForge\\\\AxiForge.exe,0"}'),
      existsSync: vi.fn().mockImplementation((p: string) => p === 'C:\\Apps\\AxiForge\\AxiForge.exe')
    })
    expect(resolveAxiforgeExe(dataDir, io)).toBe('C:\\Apps\\AxiForge\\AxiForge.exe')
  })

  it('returns null when nothing is found', () => {
    expect(resolveAxiforgeExe(dataDir, fakeIo())).toBeNull()
  })
})

describe('AxiAppLauncher.ensureRunning', () => {
  it('is a no-op when /health already responds', async () => {
    const io = fakeIo()
    const launcher = new AxiAppLauncher(flakyClient(0), dataDir, io, { timeoutMs: 1000, pollMs: 10 })
    await launcher.ensureRunning()
    expect(io.spawn).not.toHaveBeenCalled()
  })

  it('spawns detached with --headless and a sanitized env, then polls to success', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173'
    process.env.NODE_OPTIONS = '--max-old-space-size=4096'
    const io = fakeIo({
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage'] : []
      )
    })
    const launcher = new AxiAppLauncher(flakyClient(3), dataDir, io, { timeoutMs: 5000, pollMs: 10 })
    await launcher.ensureRunning()
    const [cmd, args, opts] = (io.spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(cmd).toMatch(/AxiForge-1\.4\.0\.AppImage$/)
    expect(args).toEqual(['--headless'])
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(opts.env.VITE_DEV_SERVER_URL).toBeUndefined()
    expect(opts.env.NODE_OPTIONS).toBeUndefined()
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    delete process.env.VITE_DEV_SERVER_URL
    delete process.env.NODE_OPTIONS
  })

  it('wraps the spawn in systemd-run --user --scope when available on linux', async () => {
    const io = fakeIo({
      hasSystemdRun: () => true,
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage'] : []
      )
    })
    const launcher = new AxiAppLauncher(flakyClient(1), dataDir, io, { timeoutMs: 5000, pollMs: 10 })
    await launcher.ensureRunning()
    const [cmd, args] = (io.spawn as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(cmd).toBe('systemd-run')
    expect(args.slice(0, 3)).toEqual(['--user', '--scope', '--'])
    expect(args[args.length - 1]).toBe('--headless')
  })

  it('errors with an install hint when no executable is found', async () => {
    const launcher = new AxiAppLauncher(flakyClient(99), dataDir, fakeIo(), { timeoutMs: 100, pollMs: 10 })
    const err = await launcher.ensureRunning().catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err.message).toMatch(/install/i)
  })

  it('errors when the API never comes up within the timeout', async () => {
    const io = fakeIo({
      readdirSync: vi.fn().mockImplementation((dir: string) =>
        dir.endsWith('AppImages') ? ['AxiForge-1.4.0.AppImage'] : []
      )
    })
    const launcher = new AxiAppLauncher(flakyClient(Infinity), dataDir, io, { timeoutMs: 50, pollMs: 10 })
    const err = await launcher.ensureRunning().catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err.message).toMatch(/did not come up/i)
  })
})
```

- [ ] Run expecting failure:

```
npx vitest run --maxWorkers=2 src/main/axiAppLauncher.test.ts
```

- [ ] Implement `src/main/axiAppLauncher.ts`:

```ts
import { spawn as nodeSpawn } from 'child_process'
import { execSync as nodeExecSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { AxiforgeError, AxiforgeNotRunningError, type AxiforgeDiscovery } from './axiforgeClient'

/** Injectable system surface so tests never touch the real OS. */
export interface LauncherIo {
  platform: NodeJS.Platform
  spawn: typeof nodeSpawn
  execSync: (cmd: string, opts: { encoding: 'utf8'; timeout: number; windowsHide?: boolean }) => string
  existsSync: typeof existsSync
  readdirSync: (dir: string) => string[]
  statSync: typeof statSync
  hasSystemdRun: () => boolean
}

export const defaultIo: LauncherIo = {
  platform: process.platform,
  spawn: nodeSpawn,
  execSync: (cmd, opts) => nodeExecSync(cmd, opts),
  existsSync,
  readdirSync: (dir) => readdirSync(dir),
  statSync,
  hasSystemdRun: () => {
    try {
      nodeExecSync('command -v systemd-run', { encoding: 'utf8', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }
}

// Ported from axiom electron/ipc-handlers.ts:366-384 — registry lookup, then
// DisplayIcon exe or an InstallLocation directory scan.
function resolveWindows(io: LauncherIo): string | null {
  try {
    const ps = `(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*AxiForge*' } | Select-Object -First 1 InstallLocation, DisplayIcon | ConvertTo-Json -Compress)`
    const raw = io
      .execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true
      })
      .trim()
    if (!raw) return null
    const entry = JSON.parse(raw) as { InstallLocation?: string; DisplayIcon?: string }
    const icon = entry.DisplayIcon?.split(',')[0]?.trim()
    if (icon && icon.toLowerCase().endsWith('.exe') && io.existsSync(icon)) return icon
    const loc = entry.InstallLocation?.trim()
    if (loc && io.existsSync(loc) && io.statSync(loc).isDirectory()) {
      const exes = io.readdirSync(loc).filter((f) => f.endsWith('.exe') && !/uninstall/i.test(f))
      const preferred = exes.find((f) => f.toLowerCase() === 'axiforge.exe') ?? exes[0]
      if (preferred) return join(loc, preferred)
    }
  } catch {
    /* registry query failed — fall through to null */
  }
  return null
}

// Ported from axiom electron/detect.ts:64-79 + ipc-handlers.ts:328-344.
// Gear Lever stores AppImages under ~/AppImages, so this scan covers it;
// its metadata.json / the axiom-version convention only carry versions.
function resolveLinux(io: LauncherIo): string | null {
  const searchDirs = [
    join(homedir(), 'AppImages'),
    join(homedir(), 'Applications'),
    join(homedir(), 'Downloads'),
    join(homedir(), '.local', 'bin'),
    homedir()
  ]
  for (const dir of searchDirs) {
    try {
      const file = io
        .readdirSync(dir)
        .find((f) => f.toLowerCase().endsWith('.appimage') && f.toLowerCase().includes('axiforge'))
      if (file) return join(dir, file)
    } catch {
      /* dir missing — keep scanning */
    }
  }
  return null
}

/** Resolution order per spec: discovery-file exePath first, then platform detection. */
export function resolveAxiforgeExe(dataDir: string, io: LauncherIo = defaultIo): string | null {
  try {
    const disc = JSON.parse(readFileSync(join(dataDir, 'local-api.json'), 'utf8')) as AxiforgeDiscovery
    if (typeof disc.exePath === 'string' && disc.exePath && io.existsSync(disc.exePath)) {
      return disc.exePath
    }
  } catch {
    /* no/stale discovery file — detect instead */
  }
  if (io.platform === 'win32') return resolveWindows(io)
  if (io.platform === 'linux') return resolveLinux(io)
  return null
}

/** The only client surface the launcher needs — keeps tests trivial. */
export interface HealthCheckable {
  health(): Promise<{ ok: boolean; version: string }>
}

export class AxiAppLauncher {
  constructor(
    private readonly client: HealthCheckable,
    private readonly dataDir: string,
    private readonly io: LauncherIo = defaultIo,
    private readonly timing: { timeoutMs: number; pollMs: number } = { timeoutMs: 15_000, pollMs: 500 }
  ) {}

  /** Resolves when the local API answers /health; throws AxiforgeError (friendly) otherwise. */
  async ensureRunning(): Promise<void> {
    try {
      await this.client.health()
      return
    } catch (err) {
      if (!(err instanceof AxiforgeNotRunningError)) throw err
    }
    const exe = resolveAxiforgeExe(this.dataDir, this.io)
    if (!exe) {
      throw new AxiforgeError(
        'AxiForge does not appear to be installed on this machine — install it via AxiOM, or open it once so AxiVale can find it.'
      )
    }
    this.spawnHeadless(exe)
    await this.waitForHealth()
  }

  private spawnHeadless(exe: string): void {
    // Strip the parent Electron/dev env so the child boots as a normal app
    // (mirrors axiom ipc-handlers.ts:388-392).
    const env = { ...process.env }
    delete env.VITE_DEV_SERVER_URL
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    delete env.NODE_OPTIONS

    let cmd = exe
    let args = ['--headless']
    if (this.io.platform === 'linux' && this.io.hasSystemdRun()) {
      // Fresh user scope: escapes AxiVale's cgroup, avoiding Electron 37+
      // GPU sandbox failures (axiom ipc-handlers.ts:321-324).
      cmd = 'systemd-run'
      args = ['--user', '--scope', '--', exe, '--headless']
    }
    const child = this.io.spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      cwd: dirname(exe),
      env
    })
    // Spawn errors (ENOENT, EACCES) surface as the poll timeout below.
    child.on('error', () => {})
    child.unref()
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.timing.timeoutMs
    for (;;) {
      try {
        await this.client.health()
        return
      } catch (err) {
        if (!(err instanceof AxiforgeNotRunningError)) throw err
      }
      if (Date.now() >= deadline) {
        throw new AxiforgeError(
          'AxiForge was launched but its local API did not come up in time — try opening AxiForge manually, then retry.'
        )
      }
      await new Promise((r) => setTimeout(r, this.timing.pollMs))
    }
  }
}
```

Note: `client.health()` already re-reads the discovery file on every call (Task 2), so polling health *is* polling discovery + health combined.

- [ ] Run expecting pass, then full suite + typecheck:

```
npx vitest run --maxWorkers=2 src/main/axiAppLauncher.test.ts
npx vitest run --maxWorkers=2
npm run typecheck
```

- [ ] Commit:

```
git add -A && git commit -m "feat: AxiAppLauncher — headless AxiForge spawn ported from axiom detect/launch" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---## Task 4: `src/main/tools/axiforge.ts` — the 13 AxiForge tools + destructive gating + auto-spawn-on-write

New tool module per the spec table. Mutations (`save`, `delete`, `publish`, both imports) go through an auto-spawn wrapper: call the client; on `AxiforgeNotRunningError` → `launcher.ensureRunning()` → retry once. Launcher failures throw `AxiforgeError` with a friendly actionable message, which the existing `safe()` wrapper converts to an `isError` text result — nothing ever throws to the provider. Deletes and publishes join `DESTRUCTIVE_TOOLS`, which `evaluateToolPermission` (`src/main/providers/permission.ts:31`) already routes to the confirm dialog with no changes.

Per the plan header note: `AgentEvent` has no `display` field today, so get/save return plain compact JSON; `build-card`/`comp-card` display attachment lands in the separate rendering plan.

**Files:**
- Create: `src/main/tools/axiforge.ts`
- Create: `src/main/tools/axiforge.test.ts`
- Modify: `src/main/tools/shared.ts` (extend `ToolDeps` with `axiforge` + `axiforgeLauncher`)
- Modify: `src/main/tools/index.ts` (compose `buildAxiforgeTools`, extend `DESTRUCTIVE_TOOLS`)
- Modify: `src/main/tools/inventory.test.ts` (extend the expected inventory + destructive list)
- Modify: `src/main/tools.test.ts:9-53` (`makeDeps()` gains `axiforge`/`axiforgeLauncher` stubs) and `:77-80` (destructive list assertions)
- Modify: `src/main/providers/toolSchema.test.ts:33-38` (the inline deps object gains the two new fields)

**Steps:**

- [ ] Write the failing test `src/main/tools/axiforge.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS } from './index'
import type { ToolDeps } from './shared'
import { AxiforgeNotRunningError } from '../axiforgeClient'

function makeDeps(): ToolDeps {
  return {
    axitools: {} as never,
    gw2: {} as never,
    discordGuildId: () => '1',
    gw2GuildId: () => 'g1',
    axiforge: {
      listBuilds: vi.fn().mockResolvedValue([
        { id: 'b1', title: 'Heal FB', profession: 'Guardian', tags: ['wvw'], folderId: 'f1', updatedAt: '2026-06-01T00:00:00.000Z', skills: { heal: 1 } }
      ]),
      getBuild: vi.fn().mockResolvedValue({ id: 'b1', title: 'Heal FB', profession: 'Guardian' }),
      saveBuild: vi.fn().mockResolvedValue({ id: 'b1', title: 'Renamed' }),
      deleteBuild: vi.fn().mockResolvedValue(undefined),
      publishBuild: vi.fn().mockResolvedValue({ url: 'https://axiforge.app/b/heal-fb' }),
      listComps: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Zerg', folderId: null, updatedAt: '2026-06-02T00:00:00.000Z' }]),
      getComp: vi.fn().mockResolvedValue({ id: 'c1', name: 'Zerg' }),
      saveComp: vi.fn().mockResolvedValue({ id: 'c1', name: 'Zerg v2' }),
      deleteComp: vi.fn().mockResolvedValue(undefined),
      publishComp: vi.fn().mockResolvedValue({ url: 'https://axiforge.app/c/zerg' }),
      listFolders: vi.fn().mockResolvedValue([{ id: 'f1', name: 'WvW' }]),
      importChatLink: vi.fn().mockResolvedValue({ id: 'b9', title: 'Imported' }),
      importGw2skills: vi.fn().mockResolvedValue({ id: 'b10', title: 'Imported 2' }),
      catalogProfessions: vi.fn().mockResolvedValue([{ id: 'Guardian' }]),
      catalogProfession: vi.fn().mockResolvedValue({ id: 'Guardian', specializations: [] }),
      catalogUpgrades: vi.fn().mockResolvedValue([{ id: 24836 }])
    } as never,
    axiforgeLauncher: { ensureRunning: vi.fn().mockResolvedValue(undefined) }
  }
}

function find(deps: ToolDeps, name: string) {
  return buildOfficerTools(deps).find((t) => t.name === name)!
}

describe('axiforge tools', () => {
  it('registers all 13 axiforge tools', () => {
    const names = buildOfficerTools(makeDeps()).map((t) => t.name)
    for (const n of [
      'axiforge_builds_list',
      'axiforge_builds_get',
      'axiforge_builds_save',
      'axiforge_builds_delete',
      'axiforge_comps_list',
      'axiforge_comps_get',
      'axiforge_comps_save',
      'axiforge_comps_delete',
      'axiforge_build_publish',
      'axiforge_comp_publish',
      'axiforge_import_chat_link',
      'axiforge_import_gw2skills',
      'axiforge_catalog'
    ]) {
      expect(names).toContain(n)
    }
  })

  it('marks deletes and publishes destructive', () => {
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_builds_delete')
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_comps_delete')
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_build_publish')
    expect(DESTRUCTIVE_TOOLS).toContain('axiforge_comp_publish')
  })

  it('builds_list is compact: id/title/profession/tags/folder/updatedAt only', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_builds_list').handler({}, {})
    const text = (result.content[0] as { text: string }).text
    expect(JSON.parse(text)).toEqual([
      { id: 'b1', title: 'Heal FB', profession: 'Guardian', tags: ['wvw'], folder: 'WvW', updatedAt: '2026-06-01T00:00:00.000Z' }
    ])
    expect(text).not.toContain('skills')
  })

  it('builds_get returns the full build', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_builds_get').handler({ build_id: 'b1' }, {})
    expect(deps.axiforge.getBuild).toHaveBeenCalledWith('b1')
    expect((result.content[0] as { text: string }).text).toContain('Heal FB')
  })

  it('builds_save passes the full build object through', async () => {
    const deps = makeDeps()
    await find(deps, 'axiforge_builds_save').handler({ build: { id: 'b1', title: 'Renamed' } }, {})
    expect(deps.axiforge.saveBuild).toHaveBeenCalledWith({ id: 'b1', title: 'Renamed' })
  })

  it('auto-spawns headless AxiForge and retries once when a write hits a closed app', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.saveBuild as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AxiforgeNotRunningError())
      .mockResolvedValueOnce({ id: 'b1', title: 'Renamed' })
    const result = await find(deps, 'axiforge_builds_save').handler({ build: { id: 'b1', title: 'Renamed' } }, {})
    expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
    expect(deps.axiforge.saveBuild).toHaveBeenCalledTimes(2)
    expect(result.isError).toBeUndefined()
  })

  it('returns a friendly error string (never throws) when spawn fails', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.deleteBuild as ReturnType<typeof vi.fn>).mockRejectedValue(new AxiforgeNotRunningError())
    ;(deps.axiforgeLauncher.ensureRunning as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('AxiForge does not appear to be installed on this machine — install it via AxiOM, or open it once so AxiVale can find it.')
    )
    const result = await find(deps, 'axiforge_builds_delete').handler({ build_id: 'b1' }, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/install/i)
  })

  it('publishes return the share URL', async () => {
    const deps = makeDeps()
    const result = await find(deps, 'axiforge_build_publish').handler({ build_id: 'b1' }, {})
    expect((result.content[0] as { text: string }).text).toContain('https://axiforge.app/b/heal-fb')
  })

  it('imports are writes: chat-link import auto-spawns too', async () => {
    const deps = makeDeps()
    ;(deps.axiforge.importChatLink as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new AxiforgeNotRunningError())
      .mockResolvedValueOnce({ id: 'b9' })
    await find(deps, 'axiforge_import_chat_link').handler({ chat_code: '[&DQE...]' }, {})
    expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
  })

  it('catalog routes kinds to the right client methods', async () => {
    const deps = makeDeps()
    const catalog = find(deps, 'axiforge_catalog')
    await catalog.handler({ kind: 'professions' }, {})
    expect(deps.axiforge.catalogProfessions).toHaveBeenCalled()
    await catalog.handler({ kind: 'profession', profession_id: 'Guardian', game_mode: 'wvw' }, {})
    expect(deps.axiforge.catalogProfession).toHaveBeenCalledWith('Guardian', 'wvw')
    await catalog.handler({ kind: 'upgrades' }, {})
    expect(deps.axiforge.catalogUpgrades).toHaveBeenCalled()
    const bad = await catalog.handler({ kind: 'profession' }, {})
    expect(bad.isError).toBe(true)
  })
})
```

- [ ] Run expecting failure (tool names missing, `ToolDeps` lacks the fields):

```
npx vitest run --maxWorkers=2 src/main/tools/axiforge.test.ts
```

- [ ] Extend `ToolDeps` in `src/main/tools/shared.ts` — add the imports and two fields:

```ts
import type { AxiforgeClient } from '../axiforgeClient'

/** Structural launcher type so tests stub one method instead of the whole class. */
export interface AxiforgeLauncherLike {
  ensureRunning(): Promise<void>
}
```

and inside `ToolDeps`:

```ts
  /** Local AxiForge app client (API with read-only file fallback). */
  axiforge: AxiforgeClient
  /** Spawns headless AxiForge when a write needs it. */
  axiforgeLauncher: AxiforgeLauncherLike
```

- [ ] Implement `src/main/tools/axiforge.ts`:

```ts
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
```

- [ ] Wire into `src/main/tools/index.ts` — add the import, extend the composition and the destructive list:

```ts
import { buildAxiforgeTools, AXIFORGE_DESTRUCTIVE_TOOLS } from './axiforge'
```

```ts
/** Tools that mutate data irreversibly (or publish publicly) — the UI asks the user to confirm before running these. */
export const DESTRUCTIVE_TOOLS = [
  'axitools_builds_delete',
  'axitools_comp_presets_delete',
  ...AXIFORGE_DESTRUCTIVE_TOOLS
]
```

```ts
  return [
    ...buildAxitoolsTools(deps),
    ...buildDiscordTools(deps),
    ...buildGw2Tools(deps),
    ...buildAxiforgeTools(deps)
  ]
```

- [ ] Update the now-stale tests:
  - `src/main/tools/inventory.test.ts`: add the 13 `axiforge_*` names to the sorted expected array (sorted: `axiforge_build_publish`, `axiforge_builds_delete`, `axiforge_builds_get`, `axiforge_builds_list`, `axiforge_builds_save`, `axiforge_catalog`, `axiforge_comp_publish`, `axiforge_comps_delete`, `axiforge_comps_get`, `axiforge_comps_list`, `axiforge_comps_save`, `axiforge_import_chat_link`, `axiforge_import_gw2skills` — interleaved alphabetically before the `axitools_*` block), change the `DESTRUCTIVE_TOOLS` assertion to the six-element list, and add `axiforge: {} as never, axiforgeLauncher: { ensureRunning: async () => {} }` to its `deps`.
  - `src/main/tools.test.ts` `makeDeps()` (lines 9–53): add the same two stub fields.
  - `src/main/providers/toolSchema.test.ts` (lines 33–38): add `axiforge: {} as never, axiforgeLauncher: { ensureRunning: async () => {} }` to the inline deps object.
- [ ] Run expecting pass, then full suite + typecheck:

```
npx vitest run --maxWorkers=2 src/main/tools/axiforge.test.ts
npx vitest run --maxWorkers=2
npm run typecheck
```

- [ ] Commit:

```
git add -A && git commit -m "feat: axiforge_* officer tools with auto-spawn-on-write and destructive gating" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Wiring — `ToolDeps` in main entry + system-prompt additions

`src/main/index.ts` constructs one `AxiforgeClient` (AxiForge data dir + AxiVale-side catalog cache path) and one `AxiAppLauncher` at startup and hands them to the agent's `toolDeps`. `agent.ts` gains the AxiForge rules: capability description, the grounding requirement (catalog/official API over model memory — GW2 balance changes invalidate training data), and the confirm-dialog note for destructive AxiForge actions.

**Files:**
- Modify: `src/main/index.ts` (imports near line 17; client/launcher construction + `toolDeps` near lines 87–94)
- Modify: `src/main/agent.ts` (export `AXIVALE_SYSTEM_PROMPT` at line 12; extend the prompt's Rules block ending at line 53)
- Create: `src/main/systemPrompt.test.ts`

**Steps:**

- [ ] Write the failing test `src/main/systemPrompt.test.ts` (fails: `AXIVALE_SYSTEM_PROMPT` is not exported and lacks the content):

```ts
import { describe, it, expect } from 'vitest'
import { AXIVALE_SYSTEM_PROMPT } from './agent'

describe('system prompt', () => {
  it('describes the AxiForge capabilities and confirm flow', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/headless/i)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/deletes and publishes prompt the user to confirm/i)
  })

  it('requires grounding build edits in catalog/API data, not model memory', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_catalog')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/balance patches invalidate your training data/i)
  })

  it('separates the AxiForge store from the AxiTools Discord store', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/axiforge_\* .*axitools_builds_\*/s)
  })
})
```

- [ ] Run expecting failure:

```
npx vitest run --maxWorkers=2 src/main/systemPrompt.test.ts
```

- [ ] In `src/main/agent.ts`, change line 12 from `const AXIVALE_SYSTEM_PROMPT = …` to `export const AXIVALE_SYSTEM_PROMPT = …`, and insert these rules immediately before the final "Keep replies concise" rule (line 52):

```
- AxiForge is the user's local desktop build editor — a different store from
  the AxiTools Discord bot. Use the axiforge_* tools to list, read, create,
  edit, delete, publish, and import its builds and squad comps; use
  axitools_builds_* only for the Discord bot's build list. Never conflate
  axiforge_* and axitools_builds_* data. Reads work even when AxiForge is
  closed; writes start AxiForge headless automatically — just call the tool.
  AxiForge deletes and publishes prompt the user to confirm via dialog; call
  the tool and let the confirmation flow happen.
- NEVER design or edit a build from memory: GW2 balance patches invalidate
  your training data. Ground every skill, trait, specialization, and gear
  choice in axiforge_catalog and the official API (gw2_api) before saving,
  and say so when the user asks for build advice.
```

- [ ] In `src/main/index.ts`, add the imports after line 16 (`import { setupUpdater } from './updater'`):

```ts
import { AxiforgeClient, forgeDataDir } from './axiforgeClient'
import { AxiAppLauncher } from './axiAppLauncher'
```

then inside `app.whenReady().then(async () => {` after the `buildGw2` line (line 65):

```ts
  const axiforgeDataDir = forgeDataDir()
  const axiforge = new AxiforgeClient({
    dataDir: axiforgeDataDir,
    catalogCachePath: join(app.getPath('userData'), 'axiforge-catalog.json')
  })
  const axiforgeLauncher = new AxiAppLauncher(axiforge, axiforgeDataDir)
```

and extend the `toolDeps` object (lines 88–94):

```ts
    toolDeps: () => ({
      axitools: buildAxitools(),
      gw2: buildGw2(),
      // Kept as a string: Discord snowflakes exceed Number.MAX_SAFE_INTEGER.
      discordGuildId: () => store.getSetting('guildId') ?? '',
      gw2GuildId: () => store.getSetting('gw2GuildId') ?? '',
      axiforge,
      axiforgeLauncher
    }),
```

- [ ] Run expecting pass, then full suite + typecheck:

```
npx vitest run --maxWorkers=2 src/main/systemPrompt.test.ts
npx vitest run --maxWorkers=2
npm run typecheck
```

- [ ] Commit:

```
git add -A && git commit -m "feat: wire AxiforgeClient/launcher into ToolDeps and teach the system prompt AxiForge" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Settings UI — AxiForge connection indicator

A new "AxiForge" settings group following the existing AxiTools/Local patterns in `Settings.tsx` (`sgroup`/`sstatus ok|err`/`sbtn out` classes, probe on mount + manual recheck). States: green "connected · vX" when `/health` responds; "file-only" when reading from the disk fallback; "not found" otherwise. Backed by an `axiforge:status` IPC handler that calls `AxiforgeClient.status()` (already implemented and unit-tested in Task 2 — the main-process handler is a one-liner, verified by typecheck; there is no React component test infrastructure in this repo, so the renderer side is verified by `npm run typecheck` and manual run).

**Files:**
- Modify: `src/main/index.ts` (new IPC handle next to `axitools:status`, after line 168)
- Modify: `src/preload/index.ts` (new bridge entry, after `axitoolsStatus` at line 9)
- Modify: `src/preload/index.d.ts` (new `OfficerApi` member, after `axitoolsStatus` declaration)
- Modify: `src/renderer/src/components/Settings.tsx` (state near line 132, probe effect near line 154, new `sgroup` after the AxiTools group ending at line 592)

**Steps:**

- [ ] Add the IPC handler in `src/main/index.ts` directly after the `axitools:status` handler (line 168):

```ts
  ipcMain.handle('axiforge:status', () => axiforge.status())
```

- [ ] Add the bridge entry in `src/preload/index.ts` after `axitoolsStatus` (line 9):

```ts
  axiforgeStatus: () => ipcRenderer.invoke('axiforge:status'),
```

- [ ] Add the declaration in `src/preload/index.d.ts` after the `axitoolsStatus` member:

```ts
  axiforgeStatus(): Promise<
    { state: 'connected'; version: string } | { state: 'file-only' } | { state: 'offline' }
  >
```

- [ ] Run typecheck expecting failure in the renderer (Settings.tsx not yet using it is fine — this step's failure mode is the *next* step compiling; run it after both edits if preferred). Then update `src/renderer/src/components/Settings.tsx`:

State (with the other groups' state, after the AxiTools block at line 132):

```tsx
  // AxiForge
  const [forgeStatus, setForgeStatus] = useState<
    { state: 'connected'; version: string } | { state: 'file-only' } | { state: 'offline' } | null
  >(null)
```

Probe function + mount probe (add `void checkForge()` inside the existing mount `useEffect` at line 141–154, after `await refreshKeyLists()`):

```tsx
  async function checkForge(): Promise<void> {
    setForgeStatus(null)
    setForgeStatus(await window.officer.axiforgeStatus())
  }
```

New group JSX, inserted between the AxiTools `sgroup` (ends line 592) and the About `sgroup` (line 594):

```tsx
      <div className="sgroup">
        <h2>AxiForge</h2>
        <div className="srow">
          {forgeStatus === null && <div className="sstatus ok">checking…</div>}
          {forgeStatus?.state === 'connected' && (
            <div className="sstatus ok">connected · v{forgeStatus.version}</div>
          )}
          {forgeStatus?.state === 'file-only' && (
            <div className="sstatus ok">
              file-only · AxiForge is closed — builds are read from disk; edits will start it
              headless
            </div>
          )}
          {forgeStatus?.state === 'offline' && (
            <div className="sstatus err">not found — install AxiForge via AxiOM</div>
          )}
          <button className="sbtn out" onClick={checkForge}>
            Recheck
          </button>
        </div>
        <p className="shelp">
          AxiVale edits AxiForge builds and comps through its local API. No setup needed — the
          connection is discovered automatically when AxiForge runs on this machine.
        </p>
      </div>
```

- [ ] Verify:

```
npm run typecheck
npx vitest run --maxWorkers=2
```

- [ ] Manually verify the indicator states with `npm run dev` (connected with AxiForge open, file-only with it closed but installed, offline with the data dir absent — can be simulated by pointing `forgeDataDir` at an empty temp dir during the check).
- [ ] Commit:

```
git add -A && git commit -m "feat: AxiForge connection indicator in Settings (connected / file-only / not found)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Error-handling coverage map (spec section 7 rows owned by this plan)

| Failure | Where handled |
|---|---|
| AxiForge closed, read requested | `AxiforgeClient.withFileFallback` (Task 2) — silent file read; Settings shows "file-only" (Task 6) |
| AxiForge closed, write requested | `write()` wrapper in `tools/axiforge.ts` (Task 4): `ensureRunning()` then retry once |
| AxiForge not installed | `AxiAppLauncher.ensureRunning` (Task 3) throws "install it via AxiOM" → `safe()` returns it as error text |
| Spawned but API never up | `waitForHealth` 15s timeout (Task 3) → friendly "did not come up in time" error text |
| Stale discovery file (app crashed) | fetch connection failure → `AxiforgeNotRunningError` in `request()` (Task 2); AxiForge overwrites the file on next start |
| Tool must never throw to the provider | every handler wrapped in `safe()` (`tools/shared.ts`), matching existing tools |
| Catalog needed while offline, never primed | explicit "open AxiForge once to prime the cache" error (Task 2) |

## Out of scope for this plan (separate plans per the spec)

- Meta-site tools (`meta_search_builds`, `meta_get_build`) and the GW2 wiki suite — spec sections 4–5.
- `display` payloads, `AgentEvent` extension, `ToolCoupon`/`ForgeCard` rendering, `@axiapps/forge-render` — spec section 6 (attach points are marked with a NOTE comment in `tools/axiforge.ts`).
- All AxiForge-repo work (local API server, headless mode) — spec section 1, assumed present.
- Shared launcher package extraction (axiom + AxiVale dedup) — explicitly future work in the spec.
