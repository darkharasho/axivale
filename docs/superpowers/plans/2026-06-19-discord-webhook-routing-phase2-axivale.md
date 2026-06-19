# Discord Webhook Routing — Phase 2 (AxiVale server resolution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every guild-scoped AxiVale tool target a chosen Discord server (via a `server` arg) instead of the single "active" key, with central resolution that asks-on-ambiguity.

**Architecture:** A pure `resolveServerEntry(servers, server?)` does the matching (throws on none/unknown/ambiguous). `ToolDeps.resolveAxitoolsServer(server?)` wraps it — builds an `AxitoolsClient` from that key, backfills the guild id from meta or a live `listGuilds`. Every guild-scoped tool gains optional `server` and calls the resolver instead of `requireDiscordGuild`. A new `discord_servers` tool + agent guidance let the agent ask the user.

**Tech Stack:** TypeScript (electron main + zod tools), Vitest.

## Global Constraints

- Each AxiVale key is bound to one Discord server; build a client from the *specific* key, not the active one.
- Server entry: `{ label: string; name: string | null; guildId: string | null }` (name/guildId from key `meta`).
- Resolver errors (thrown → `safe()` turns them into agent-visible tool errors):
  - none configured: `No Discord server is configured — add an AxiVale key in Settings (05).`
  - unknown: `Unknown Discord server "<x>". Connected servers: <labels>.`
  - ambiguous match: `"<x>" matches multiple servers: <labels>.`
  - omitted + multiple: `Multiple Discord servers connected (<labels>). Pass the `server` argument to choose one.`
- `server` matches a key by `label` OR `meta.name`, case-insensitive, trimmed.
- Tests: `npx vitest run <file> --maxWorkers=2`.

---

### Task 1: Pure matcher + `resolveAxitoolsServer`/`axivaleServers` deps

**Files:**
- Create: `src/main/serverResolve.ts`
- Create: `src/main/serverResolve.test.ts`
- Modify: `src/main/secrets.ts` (add `getKey(service, label)`)
- Modify: `src/main/tools/shared.ts` (ToolDeps: add `resolveAxitoolsServer`, `axivaleServers`)
- Modify: `src/main/index.ts` (build the two deps near line 534)

**Interfaces:**
- Produces:
  - `ServerEntry = { label: string; name: string | null; guildId: string | null }`
  - `resolveServerEntry(servers: ServerEntry[], server?: string): ServerEntry` (throws on none/unknown/ambiguous/omitted-multiple)
  - `ToolDeps.axivaleServers(): ServerEntry[]`
  - `ToolDeps.resolveAxitoolsServer(server?: string): Promise<{ client: AxitoolsClient; guildId: string; name: string | null; label: string }>`
  - `SecretStore.getKey(service, label): string | null`

- [ ] **Step 1: Write `src/main/serverResolve.ts`**

```typescript
export interface ServerEntry {
  label: string
  name: string | null
  guildId: string | null
}

const norm = (s: string): string => s.trim().toLowerCase()

/** Pick the server entry matching `server` (by label or cached name), or throw a
 *  message the agent can act on (ask the user / fix the name). With no `server`:
 *  exactly one configured ⇒ that one; otherwise throw. */
export function resolveServerEntry(servers: ServerEntry[], server?: string): ServerEntry {
  const labels = servers.map((s) => s.label).join(', ')
  if (server && server.trim()) {
    const want = norm(server)
    const matches = servers.filter(
      (s) => norm(s.label) === want || (s.name != null && norm(s.name) === want)
    )
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) {
      if (!servers.length) throw new Error('No Discord server is configured — add an AxiVale key in Settings (05).')
      throw new Error(`Unknown Discord server "${server}". Connected servers: ${labels}.`)
    }
    throw new Error(`"${server}" matches multiple servers: ${matches.map((s) => s.label).join(', ')}.`)
  }
  if (servers.length === 1) return servers[0]
  if (servers.length === 0) throw new Error('No Discord server is configured — add an AxiVale key in Settings (05).')
  throw new Error(`Multiple Discord servers connected (${labels}). Pass the \`server\` argument to choose one.`)
}
```

- [ ] **Step 2: Write `src/main/serverResolve.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { resolveServerEntry, type ServerEntry } from './serverResolve'

const S = (label: string, name: string | null = label): ServerEntry => ({ label, name, guildId: '1' })

describe('resolveServerEntry', () => {
  it('returns the only server when none requested', () => {
    expect(resolveServerEntry([S('DEFI')]).label).toBe('DEFI')
  })
  it('matches by label, case-insensitive', () => {
    expect(resolveServerEntry([S('DEFI'), S('EWW')], 'eww').label).toBe('EWW')
  })
  it('matches by cached server name', () => {
    expect(resolveServerEntry([S('DEFI', 'Engaging Without Warning')], 'engaging without warning').label).toBe('DEFI')
  })
  it('throws listing servers when ambiguous (omitted + multiple)', () => {
    expect(() => resolveServerEntry([S('DEFI'), S('EWW')])).toThrow(/Multiple Discord servers connected \(DEFI, EWW\)/)
  })
  it('throws on unknown server', () => {
    expect(() => resolveServerEntry([S('DEFI')], 'nope')).toThrow(/Unknown Discord server "nope". Connected servers: DEFI/)
  })
  it('throws when none configured', () => {
    expect(() => resolveServerEntry([], 'x')).toThrow(/No Discord server is configured/)
  })
})
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run src/main/serverResolve.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Add `getKey` to the secret store**

In `src/main/secrets.ts`, next to `getActiveKey` (~line 218):
```typescript
  /** A specific key's material by label, or null if absent. */
  getKey(service: KeyService, label: string): string | null {
    return this.readRing(service).find((k) => k.label === label)?.key ?? null
  }
```

- [ ] **Step 5: Extend `ToolDeps` in `src/main/tools/shared.ts`**

Add after `axitools: AxitoolsClient`:
```typescript
  /** All saved Discord (AxiVale-key) servers, for enumeration. */
  axivaleServers: () => import('../serverResolve').ServerEntry[]
  /** Resolve `server` (label/name) → that server's client + guild. Throws an
   *  agent-actionable message on none/unknown/ambiguous input. */
  resolveAxitoolsServer: (
    server?: string
  ) => Promise<{ client: AxitoolsClient; guildId: string; name: string | null; label: string }>
```
(If the inline `import(...)` type is awkward, add `import type { ServerEntry } from '../serverResolve'` at the top and use `ServerEntry[]`.)

- [ ] **Step 6: Wire the deps in `index.ts` (near line 534, beside `axitools: buildAxitools()`)**

```typescript
      axivaleServers: () =>
        store.listKeyLabels('axivale').map((k) => ({
          label: k.label,
          name: k.meta?.name ?? null,
          guildId: k.meta?.id ?? null
        })),
      resolveAxitoolsServer: async (server?: string) => {
        const { resolveServerEntry } = await import('./serverResolve')
        const servers = store.listKeyLabels('axivale').map((k) => ({
          label: k.label, name: k.meta?.name ?? null, guildId: k.meta?.id ?? null
        }))
        const entry = resolveServerEntry(servers, server)
        const parsed = parseAxivaleKey(store.getKey('axivale', entry.label) ?? '')
        if (!parsed) throw new AxitoolsError(`The AxiVale key "${entry.label}" is invalid — regenerate it.`)
        const client = new AxitoolsClient(parsed.baseUrl, parsed.token)
        let { guildId, name } = entry
        if (!guildId) {
          const guilds = await client.listGuilds()
          if (!guilds.length) throw new AxitoolsError(`The bot isn't in the "${entry.label}" server, or the key is wrong.`)
          guildId = String(guilds[0].id)
          name = guilds[0].name
          store.setKeyMeta('axivale', entry.label, { id: guildId, name })
        }
        return { client, guildId, name, label: entry.label }
      },
```
Ensure `AxitoolsError` is imported in `index.ts` (from `./axitoolsClient`); add the import if missing.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/serverResolve.ts src/main/serverResolve.test.ts src/main/secrets.ts src/main/tools/shared.ts src/main/index.ts
git commit -m "feat(tools): server resolver + axivaleServers/resolveAxitoolsServer deps"
```

---

### Task 2: `discord_servers` tool + thread `server` through `discord.ts`

**Files:**
- Modify: `src/main/tools/discord.ts`
- Test: `src/main/tools.test.ts` (discord_overview with `server`; discord_servers)

**Interfaces:**
- Consumes: `deps.resolveAxitoolsServer`, `deps.axivaleServers` (Task 1).
- Produces: tool `discord_servers`; `server` param on `discord_overview`, `discord_messages`, `discord_action`.

**Threading transformation (apply to each guild-scoped tool):**
1. Add `server: z.string().optional().describe('Which Discord server (label or name). Omit if only one is connected; if several are and the user did not say, ask them.')` to the zod schema.
2. In the handler, replace `requireDiscordGuild(deps)` / `deps.axitools` with:
   `const { client, guildId } = await deps.resolveAxitoolsServer(server)` then use `client` + `guildId`.
3. Destructure `server` from the handler args.

- [ ] **Step 1: Add `discord_servers` tool (top of the returned array in `discord.ts`)**

```typescript
    tool(
      'discord_servers',
      'List the Discord servers AxiVale can act on (label + cached name). Use this to pick or ask the user which server a Discord action should target.',
      {},
      safe(async () => deps.axivaleServers())
    ),
```

- [ ] **Step 2: Thread `server` through `discord_overview`**

```typescript
    tool(
      'discord_overview',
      'Full snapshot of a connected Discord server: channels, categories, roles, threads, events. Pass include_members for the member list.',
      {
        server: z.string().optional().describe('Which Discord server (label or name); omit if only one is connected, ask the user if several'),
        include_members: z.boolean().optional().describe('Also list members with their role ids')
      },
      safe(async ({ server, include_members }) => {
        const { client, guildId } = await deps.resolveAxitoolsServer(server)
        return client.discordOverview(guildId, include_members ?? false)
      })
    ),
```

- [ ] **Step 3: Thread `server` through `discord_messages` and `discord_action`**

Apply the same transformation: add `server` to each schema; in each handler do `const { client, guildId } = await deps.resolveAxitoolsServer(server)` and call `client.discordMessages(guildId, …)` / `client.discordAction(guildId, action, params ?? {})`. Remove the `requireDiscordGuild` import usage in this file.

- [ ] **Step 4: Tests in `src/main/tools.test.ts`**

Update `makeDeps()` to provide the new deps (do this once for the whole file):
```typescript
    axivaleServers: () => [{ label: 'DEFI', name: 'DEFI', guildId: '123' }],
    resolveAxitoolsServer: async () => ({ client: deps.axitools, guildId: '123', name: 'DEFI', label: 'DEFI' }),
```
(Where `deps.axitools` is the existing fake client. For an explicit-server test, override `resolveAxitoolsServer` to assert the arg.)

Add:
```typescript
  it('discord_servers lists the saved servers', async () => {
    const deps = makeDeps()
    const tool = find(deps, 'discord_servers')
    const res = await tool.handler({}, {})
    expect((res.content[0] as { text: string }).text).toContain('DEFI')
  })

  it('discord_overview resolves the requested server', async () => {
    const deps = makeDeps()
    const seen: string[] = []
    deps.resolveAxitoolsServer = async (server?: string) => { seen.push(server ?? ''); return { client: deps.axitools, guildId: '123', name: 'EWW', label: 'EWW' } }
    await find(deps, 'discord_overview').handler({ server: 'EWW' }, {})
    expect(seen).toEqual(['EWW'])
    expect(deps.axitools.discordOverview).toHaveBeenCalledWith('123', false)
  })
```
(Use the file's existing `find(deps, name)` helper; if absent, `buildOfficerTools(deps).find(t => t.name === name)`.)

- [ ] **Step 5: Run + typecheck**

Run: `npx vitest run src/main/tools.test.ts --maxWorkers=2 && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/tools/discord.ts src/main/tools.test.ts
git commit -m "feat(discord): server-targeted discord tools + discord_servers"
```

---

### Task 3: Thread `server` through `axitools.ts` (the remaining guild-scoped tools)

**Files:**
- Modify: `src/main/tools/axitools.ts`
- Test: `src/main/tools.test.ts` (one representative — `axitools_builds_list` with `server`)

**Interfaces:**
- Consumes: `deps.resolveAxitoolsServer`.

Apply the **same threading transformation** (Task 2 intro) to every tool in `axitools.ts` that currently calls `requireDiscordGuild(deps)`:
`axitools_builds_list`, `axitools_builds_create`, `axitools_builds_update`, `axitools_builds_delete`, `axitools_comp_presets_list`, `axitools_comp_presets_save`, `axitools_comp_presets_delete`, `axitools_comp_schedules_list`, `axitools_comp_schedules_save`, `axitools_audit`, `axitools_rss`, `axitools_streams`, `axitools_alliance`, `axitools_guild_roles`, `axitools_members`, `axitools_config`, `axitools_key_holders`.

For each: add `server: z.string().optional().describe(<same as Task 2 step 1>)` to its schema; in the handler replace `requireDiscordGuild(deps)` with `(await deps.resolveAxitoolsServer(server)).guildId` (or destructure `{ client, guildId }` and use `client` where it previously used `deps.axitools`). Remove the now-unused `requireDiscordGuild` import.

- [ ] **Step 1: Convert `axitools_builds_list` (worked example)**

```typescript
    tool(
      'axitools_builds_list',
      'List the Discord bot's saved builds for a server.',
      { server: z.string().optional().describe('Which Discord server (label or name); omit if only one, ask if several') },
      safe(async ({ server }) => {
        const { client, guildId } = await deps.resolveAxitoolsServer(server)
        return client.listBuilds(guildId)
      })
    ),
```

- [ ] **Step 2: Convert the remaining tools listed above**

Same transformation each. Where a handler used `const gid = requireDiscordGuild(deps)` then multiple `deps.axitools.X(gid, …)` calls, replace with `const { client, guildId } = await deps.resolveAxitoolsServer(server)` and swap `deps.axitools` → `client`, `gid` → `guildId`.

- [ ] **Step 3: Verify no stragglers**

Run: `grep -n "requireDiscordGuild" src/main/tools/axitools.ts`
Expected: no matches (import removed too).

- [ ] **Step 4: Test (representative) in `src/main/tools.test.ts`**

```typescript
  it('axitools_builds_list targets the requested server', async () => {
    const deps = makeDeps()
    deps.resolveAxitoolsServer = async (server?: string) => ({ client: deps.axitools, guildId: server === 'EWW' ? '999' : '123', name: server ?? 'DEFI', label: server ?? 'DEFI' })
    await find(deps, 'axitools_builds_list').handler({ server: 'EWW' }, {})
    expect(deps.axitools.listBuilds).toHaveBeenCalledWith('999')
  })
```

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS + clean. (Fix the `inventory.test.ts` exact tool-name list — add `discord_servers`.)

- [ ] **Step 6: Commit**

```bash
git add src/main/tools/axitools.ts src/main/tools.test.ts src/main/tools/inventory.test.ts
git commit -m "feat(axitools): thread server param through guild-scoped tools"
```

---

### Task 4: Agent guidance + inventory snapshot

**Files:**
- Modify: `src/main/agent.ts` (Discord section)
- Modify: `src/main/tools/inventory.test.ts` (add `discord_servers`; `server` params don't change names)

- [ ] **Step 1: Add agent guidance (in the AxiTools/Discord bullet area of `agent.ts`)**

```typescript
- Discord/AxiTools tools take an optional `server` (a saved Discord server's
  label or name). Infer it from the request ("post to EWW" → server "EWW"). If
  several servers are connected and the user didn't say which, call
  discord_servers and ask them — never guess. One server connected → omit it.
```

- [ ] **Step 2: Add `discord_servers` to the inventory list**

In `src/main/tools/inventory.test.ts`, add `'discord_servers',` in sorted position (after `discord_search` / before `discord_*`… place alphabetically among the `discord_` names).

- [ ] **Step 3: Full suite — expect PASS**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/agent.ts src/main/tools/inventory.test.ts
git commit -m "feat(agent): guide server selection for Discord tools"
```

---

## Self-review

- **Spec coverage:** resolver + deps (T1), discord tools + discord_servers (T2), axitools tools (T3), agent guidance + inventory (T4) — covers the Phase-2 section of the spec. Webhook tie/share + Settings UI are Phase 3 (not here). ✓
- **Placeholders:** Task 3 Step 2 intentionally states a transformation over a listed set rather than 15 near-identical blocks; Step 1 gives the full worked example and the exact `grep` gate (Step 3) proves completeness. ✓
- **Types:** `resolveAxitoolsServer` returns `{ client, guildId, name, label }` consistently across tasks; `ServerEntry` fields (`label/name/guildId`) consistent. ✓

## After Phase 2
- Phase 3 plan (webhook tie storage + share routing + Settings UI) builds on `resolveAxitoolsServer` (provides the `label` to look up the tie) and Phase 1's `listDiscordWebhooks`.
