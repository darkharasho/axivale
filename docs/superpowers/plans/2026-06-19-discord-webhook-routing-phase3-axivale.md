# Discord Webhook Routing — Phase 3 (AxiVale tie + share routing + UI) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tie each AxiVale Discord server to AxiForge comp/build webhook(s) and post shares to the chosen server's tie.

**Architecture:** Client gains `webhookIds` on the share calls + `listDiscordWebhooks()`. A new `discordWebhookTie` setting (`{ [keyLabel]: { comp: string[]; build: string[] } }`, stored as JSON) is read by a `ToolDeps.discordWebhookTie(label)` accessor. The share tools take `server`, resolve it (Phase 2's `resolveAxitoolsServer` → label), look up the tie, fail if empty, else post to those webhooks. A Settings UI lets the user pick the webhooks per key.

**Tech Stack:** TypeScript (electron main + zod tools + React renderer), Vitest.

## Global Constraints

- Phase 1 (AxiForge) HTTP must exist: `GET /discord/webhooks` → `{ comp: [{id,name}], build: [{id,name}] }`; `POST /(comps|builds)/:id/share-discord` accept `{ webhook_ids }`. Phase 2 (`resolveAxitoolsServer`) is merged.
- Tie shape: `{ [axivaleKeyLabel]: { comp: string[]; build: string[] } }`, stored under SettingKey `discordWebhookTie` as a JSON string (settings values are strings).
- No tie for the chosen server → the share tool THROWS: `No Discord webhook is tied to the server "<name>" — set one in Settings (05).`
- Share tools stay confirmation-gated + non-destructive (lists already include them; unchanged).
- `WebhookRef = { id: string; name: string }`.
- Tests: `npx vitest run <file> --maxWorkers=2`; full suite before finishing.

---

### Task 1: Client — `webhookIds` on shares + `listDiscordWebhooks`

**Files:**
- Modify: `src/main/axiforgeClient.ts` (`shareBuildToDiscord` ~257, `shareCompToDiscord` ~310; add `listDiscordWebhooks`)
- Test: `src/main/axiforgeClient.test.ts`

**Interfaces:**
- Produces: `WebhookRef = { id: string; name: string }`; `listDiscordWebhooks(): Promise<{ comp: WebhookRef[]; build: WebhookRef[] }>`; `shareCompToDiscord(id, webhookIds?: string[]): Promise<{ success: boolean; results?: Array<{ id: string; name: string; success: boolean; error?: string }> }>`; same for `shareBuildToDiscord`.

- [ ] **Step 1: Update the two share methods + add the list method**

```typescript
export interface WebhookRef { id: string; name: string }

  shareBuildToDiscord(id: string, webhookIds?: string[]): Promise<{ success: boolean }> {
    return this.request(
      'POST',
      `/builds/${encodeURIComponent(id)}/share-discord`,
      webhookIds ? { webhook_ids: webhookIds } : undefined,
      SHARE_TIMEOUT_MS
    )
  }

  shareCompToDiscord(id: string, webhookIds?: string[]): Promise<{ success: boolean }> {
    return this.request(
      'POST',
      `/comps/${encodeURIComponent(id)}/share-discord`,
      webhookIds ? { webhook_ids: webhookIds } : undefined,
      SHARE_TIMEOUT_MS
    )
  }

  /** Comp + build webhooks configured in AxiForge, for tying servers to them. */
  listDiscordWebhooks(): Promise<{ comp: WebhookRef[]; build: WebhookRef[] }> {
    return this.request('GET', '/discord/webhooks', undefined, SHARE_TIMEOUT_MS)
  }
```

- [ ] **Step 2: Add tests to `src/main/axiforgeClient.test.ts`** (mirror the existing share-discord tests' stub-server harness)

```typescript
  it('shareCompToDiscord posts webhook_ids when given', async () => {
    const port = await startStub({ 'POST /comps/c1/share-discord': { json: { success: true } } })
    writeDiscovery(port)
    await makeClient().shareCompToDiscord('c1', ['w1', 'w2'])
    expect(JSON.parse(requests[0].body)).toEqual({ webhook_ids: ['w1', 'w2'] })
  })

  it('shareCompToDiscord omits the body when no ids', async () => {
    const port = await startStub({ 'POST /comps/c1/share-discord': { json: { success: true } } })
    writeDiscovery(port)
    await makeClient().shareCompToDiscord('c1')
    expect(requests[0].body).toBe('')
  })

  it('listDiscordWebhooks returns comp + build lists', async () => {
    const port = await startStub({ 'GET /discord/webhooks': { json: { comp: [{ id: 'c1', name: 'DEFI' }], build: [] } } })
    writeDiscovery(port)
    expect(await makeClient().listDiscordWebhooks()).toEqual({ comp: [{ id: 'c1', name: 'DEFI' }], build: [] })
  })
```

- [ ] **Step 3: Run + typecheck** — `npx vitest run src/main/axiforgeClient.test.ts --maxWorkers=2 && npm run typecheck` → PASS + clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(axiforge-client): webhook_ids on shares + listDiscordWebhooks"`

---

### Task 2: Tie setting + deps + share tools resolve the tie

**Files:**
- Modify: `src/main/secrets.ts` (add `'discordWebhookTie'` to `SettingKey` union)
- Modify: `src/main/tools/shared.ts` (ToolDeps: `discordWebhookTie`)
- Modify: `src/main/index.ts` (wire the dep near the others ~537)
- Modify: `src/main/tools/axiforge.ts` (the two share tools)
- Modify: `src/main/agent.ts` (guidance)
- Test: `src/main/tools/axiforge.test.ts`

**Interfaces:**
- Produces: `ToolDeps.discordWebhookTie(label: string): { comp: string[]; build: string[] }`.

- [ ] **Step 1: Add the SettingKey** — in `secrets.ts` `SettingKey` union add `| 'discordWebhookTie'` (a JSON string: `{ [label]: { comp, build } }`).

- [ ] **Step 2: ToolDeps + dep wiring**

shared.ts:
```typescript
  /** Webhook ids tied to a Discord server (AxiVale key label), for routing shares. */
  discordWebhookTie: (label: string) => { comp: string[]; build: string[] }
```
index.ts (beside `resolveAxitoolsServer`):
```typescript
      discordWebhookTie: (label: string) => {
        try {
          const all = JSON.parse(store.getSetting('discordWebhookTie') ?? '{}') as
            Record<string, { comp?: string[]; build?: string[] }>
          const e = all[label] ?? {}
          return { comp: e.comp ?? [], build: e.build ?? [] }
        } catch {
          return { comp: [], build: [] }
        }
      },
```

- [ ] **Step 3: Rewrite the two share tools** in `axiforge.ts`

```typescript
    tool(
      'axiforge_comp_share_discord',
      'Post an already-published comp to a Discord server as a rich AxiForge embed (party grid + per-build legend). PREFER THIS over discord_action message_send. It posts to the AxiForge webhook(s) tied to the chosen server in Settings (05). The comp must be published first (axiforge_comp_publish). Starts AxiForge headless if closed; the user confirms before it posts.',
      {
        comp_id: z.string().describe('Id of the comp to share (must already be published)'),
        server: z.string().optional().describe('Which Discord server (label or name); omit if only one, ask if several')
      },
      safe(async ({ comp_id, server }) => {
        const { label, name } = await deps.resolveAxitoolsServer(server)
        const ids = deps.discordWebhookTie(label).comp
        if (!ids.length) throw new Error(`No Discord webhook is tied to the server "${name ?? label}" — set one in Settings (05).`)
        return write(() => deps.axiforge.shareCompToDiscord(comp_id, ids))
      })
    ),
    tool(
      'axiforge_build_share_discord',
      'Post an already-published build to a Discord server as a rich AxiForge embed. PREFER THIS over discord_action message_send. It posts to the AxiForge build webhook(s) tied to the chosen server in Settings (05). The build must be published first (axiforge_build_publish). Starts AxiForge headless if closed; the user confirms before it posts.',
      {
        build_id: z.string().describe('Id of the build to share (must already be published)'),
        server: z.string().optional().describe('Which Discord server (label or name); omit if only one, ask if several')
      },
      safe(async ({ build_id, server }) => {
        const { label, name } = await deps.resolveAxitoolsServer(server)
        const ids = deps.discordWebhookTie(label).build
        if (!ids.length) throw new Error(`No Discord webhook is tied to the server "${name ?? label}" — set one in Settings (05).`)
        return write(() => deps.axiforge.shareBuildToDiscord(build_id, ids))
      })
    ),
```

- [ ] **Step 4: Agent guidance** in `agent.ts` (extend the existing share bullet ~117): note the share posts to the webhook(s) tied to the chosen server, and an untied server errors until set in Settings.

- [ ] **Step 5: Tests** — add to `axiforge.test.ts` (the file's `makeDeps` already stubs `resolveAxitoolsServer`; add `discordWebhookTie: () => ({ comp: [], build: [] })` to it, and override per-test):

```typescript
  it('comp_share_discord posts the tied webhook ids for the resolved server', async () => {
    const deps = makeDeps()
    deps.resolveAxitoolsServer = async () => ({ client: {} as never, guildId: '1', name: 'DEFI', label: 'DEFI' })
    deps.discordWebhookTie = (label) => (label === 'DEFI' ? { comp: ['w1'], build: [] } : { comp: [], build: [] })
    await find(deps, 'axiforge_comp_share_discord').handler({ comp_id: 'c1', server: 'DEFI' }, {})
    expect(deps.axiforge.shareCompToDiscord).toHaveBeenCalledWith('c1', ['w1'])
  })

  it('comp_share_discord errors when no webhook is tied', async () => {
    const deps = makeDeps()
    deps.resolveAxitoolsServer = async () => ({ client: {} as never, guildId: '1', name: 'EWW', label: 'EWW' })
    deps.discordWebhookTie = () => ({ comp: [], build: [] })
    const res = await find(deps, 'axiforge_comp_share_discord').handler({ comp_id: 'c1', server: 'EWW' }, {})
    expect(res.isError).toBe(true)
    expect((res.content[0] as { text: string }).text).toMatch(/No Discord webhook is tied to the server "EWW"/)
  })
```
Also: `axiforge.test.ts` `makeDeps` already provides `resolveAxitoolsServer`; ensure `discordWebhookTie` default is added so unrelated tests compile.

- [ ] **Step 6: Run + typecheck** — `npx vitest run src/main/tools/axiforge.test.ts --maxWorkers=2 && npm run typecheck` → PASS + clean.
- [ ] **Step 7: Commit** — `git commit -am "feat(axiforge): route comp/build shares to the chosen server's tied webhooks"`

---

### Task 3: IPC + preload for listing webhooks

**Files:**
- Modify: `src/main/index.ts` (ipc handler)
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts` (expose method)

**Interfaces:**
- Produces: `window.officer.listDiscordWebhooks(): Promise<{ comp: WebhookRef[]; build: WebhookRef[] }>`. (The tie itself is read/written via the existing `getSetting`/`setSetting` with key `'discordWebhookTie'`.)

- [ ] **Step 1: IPC handler in `index.ts`** (near other axiforge IPC):
```typescript
  ipcMain.handle('axiforge:list-discord-webhooks', async () => {
    try {
      return await buildAxiforge().listDiscordWebhooks()
    } catch {
      return { comp: [], build: [] }
    }
  })
```
(Use whatever the file already uses to get the AxiforgeClient — search for an existing `axiforge:` handler and mirror it; the AxiforgeClient is the same one passed to tools.)

- [ ] **Step 2: preload** — in `src/preload/index.ts`:
```typescript
  listDiscordWebhooks: () => ipcRenderer.invoke('axiforge:list-discord-webhooks'),
```
and in `src/preload/index.d.ts` add to the officer interface:
```typescript
  listDiscordWebhooks(): Promise<{ comp: Array<{ id: string; name: string }>; build: Array<{ id: string; name: string }> }>
```

- [ ] **Step 3: typecheck** — `npm run typecheck` → clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(ipc): expose axiforge listDiscordWebhooks to the renderer"`

---

### Task 4: Settings UI — per-key webhook multiselects

**Files:**
- Modify: the AxiVale-key Settings section (find it: `src/renderer/src/components/Settings.tsx` / `src/renderer/src/components/settings/AxiTools.tsx` / `src/renderer/src/components/panels/shared.tsx` — locate where saved AxiVale keys are listed).
- Test: a focused renderer test if the section has one; otherwise rely on typecheck + manual note.

**Behavior:**
- On mount, fetch `window.officer.listDiscordWebhooks()` and `JSON.parse(getSetting('discordWebhookTie') ?? '{}')`.
- For each saved AxiVale key (label from `window.officer.listKeys('axivale')`), render two multiselects (checkbox lists are fine, match the app's newsprint style):
  - **Comp webhooks** — options = `webhooks.comp`, checked = `tie[label]?.comp`.
  - **Build webhooks** — options = `webhooks.build`, checked = `tie[label]?.build`.
- On change, update `tie[label].{comp|build}` and persist: `setSetting('discordWebhookTie', JSON.stringify(tie))`.
- If `listDiscordWebhooks()` returns empty comp+build (AxiForge closed/old), show a hint ("Open AxiForge and add a webhook in its Settings, then reopen this.") instead of empty selectors.

- [ ] **Step 1:** Locate the AxiVale-key list rendering; add the two multiselects under each key row (read the file; follow its existing form/list styling).
- [ ] **Step 2:** Wire load (webhooks + tie) and the persist-on-change to `discordWebhookTie`.
- [ ] **Step 3:** Empty-state hint when no webhooks.
- [ ] **Step 4:** `npm run typecheck` + full suite (`npx vitest run --maxWorkers=2`) → clean/PASS.
- [ ] **Step 5:** Render the section in-app (use the in-app HTML renderer / run the app) to confirm it looks right; iterate.
- [ ] **Step 6:** Commit — `git commit -am "feat(settings): per-server Discord webhook tie picker"`

---

## Self-review
- **Spec coverage:** client webhook_ids + list (T1), tie setting + deps + share routing + fail-on-empty (T2), IPC/preload (T3), Settings UI (T4). Covers the Phase-3 spec section. ✓
- **Placeholders:** Task 3 Step 1 and Task 4 Step 1 say "find/mirror the existing pattern" because the exact IPC-helper name and the key-list JSX are best read in-file; both name the candidate files and the precise behavior. ✓
- **Types:** `discordWebhookTie(label) → { comp, build }`, `listDiscordWebhooks() → { comp, build }` (WebhookRef), `shareCompToDiscord(id, webhookIds?)` consistent across tasks. ✓

## After Phase 3
All three phases land; then push AxiForge (+ release a tagged build) and AxiVale (cut a release including v0.11.6 + Phases 2–3). End-to-end: pick/ask server → publish → share routes to that server's tied webhook(s).
