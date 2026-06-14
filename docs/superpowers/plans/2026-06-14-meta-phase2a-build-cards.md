# Meta Phase 2a — Structured Build Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI render an exact build card for a MetaBattle meta build by decoding its in-game chat code (`[&DQ…]`) into a `ForgeBuild` (no save) and showing it via the existing build-card renderer.

**Architecture:** Add a no-save chat-code parse endpoint to the AxiForge desktop app (reusing its existing `decodeChatLinkToBuild`), then an AxiVale `parseChatLink` client method + a `gw2_build_card` tool that emits a `build-card` display payload (existing `ForgeCard`/`renderMiniBuildCard` pipeline, zero renderer changes).

**Tech Stack:** AxiForge (Node, jest); AxiVale (Electron main, TS, vitest); `@axiapps/forge-render` build-card renderer (already wired).

**Spec:** `docs/superpowers/specs/2026-06-14-meta-phase2a-build-cards-design.md`

**Two repos:**
- AxiForge: `/home/mstephens/Documents/GitHub/axiforge` (Task 1)
- AxiVale: `/var/home/mstephens/Documents/GitHub/axivale` (Tasks 2–5)

**Grounding (verified):** `decodeChatLinkToBuild(link, name, folderId, gameMode)` in `axiforge/src/main/buildChatLink.js` already decodes a chat link into a build object with **no save** (it's what `parseGw2Skills` uses). The save path (`builds:import-chat-link`) calls it then `store.upsertBuild`. So the no-save parse is just decode-and-return.

---

### Task 1: AxiForge — no-save `/import/chat-link/parse` endpoint

**Repo:** `/home/mstephens/Documents/GitHub/axiforge` (work on a branch, e.g. `chatlink-parse-endpoint`)
**Files:**
- Modify: `src/main/index.js` (IPC handler + ops method)
- Modify: `src/main/localApi.js` (route)
- Test: `tests/unit/localApi.test.js`

- [ ] **Step 1: Write the failing route test.** In `tests/unit/localApi.test.js`, mirror the existing `/import/gw2skills/parse` tests. Add (the test harness builds `createLocalApi` with a stub `ops` — add a `parseChatLink` stub to that ops stub wherever `parseGw2Skills` is stubbed, returning e.g. `{ profession: 'Guardian', gameMode: body.gameMode }`):
```js
  test("POST /import/chat-link/parse returns the parsed build (not saved) and forwards link + gameMode", async () => {
    const res = await req(port, token, "POST", "/import/chat-link/parse", {
      link: "[&DQEAAA==]",
      gameMode: "wvw",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profession: "Guardian", gameMode: "wvw" });
  });

  test("POST /import/chat-link/parse requires a link", async () => {
    const res = await req(port, token, "POST", "/import/chat-link/parse", {});
    expect(res.status).toBe(400);
  });
```
(Match how the existing `parseGw2Skills` ops stub is provided in this file; add a sibling `parseChatLink: (link, gameMode) => ({ profession: "Guardian", gameMode })` to the same stub ops object.)

- [ ] **Step 2: Run, expect FAIL.** Run the axiforge test suite for this file (from the axiforge repo root — use its configured runner, e.g. `npx jest tests/unit/localApi.test.js`). Expected: the two new tests fail (404/route missing).

- [ ] **Step 3: Add the route** in `src/main/localApi.js`, immediately after the `/import/gw2skills/parse` block (around line 239):
```js
    {
      method: "POST", pattern: "/import/chat-link/parse",
      handler: async ({ body }) => {
        if (!body?.link || typeof body.link !== "string") {
          throw httpError(400, "Body must include a chat link string: { link }");
        }
        return ops.parseChatLink(body.link, body.gameMode ?? undefined);
      },
    },
```

- [ ] **Step 4: Add the ops method** in `src/main/index.js` inside the `createLocalApi({ ops: { … } })` object, right after the `parseGw2Skills` entry (around line 2024):
```js
      parseChatLink: (link, gameMode) =>
        asHttpResult(invokeLocal("builds:parse-chat-link", link, gameMode), { badInput: true }),
```

- [ ] **Step 5: Add the IPC handler** in `src/main/index.js`, right after the `builds:import-chat-link` handler (around line 881):
```js
  handle("builds:parse-chat-link", async (_e, link, gameMode) => {
    const { decodeChatLinkToBuild } = require("./buildChatLink.js");
    // Decode only — no store.upsertBuild, so meta builds never pollute the library.
    return decodeChatLinkToBuild(link, null, null, gameMode);
  });
```

- [ ] **Step 6: Run, expect PASS.** Run `npx jest tests/unit/localApi.test.js` — the two new tests pass; run the full file to confirm no regressions.

- [ ] **Step 7: Commit (in the axiforge repo).**
```bash
cd /home/mstephens/Documents/GitHub/axiforge
git add src/main/index.js src/main/localApi.js tests/unit/localApi.test.js
git commit -m "feat(localApi): no-save POST /import/chat-link/parse (decode chat code without saving)"
```
NOTE: dev launcher runs AxiForge from source, so this is live immediately in the AxiVale dev loop. A packaged AxiForge release is needed before a packaged AxiVale ships this (flag for release, not blocking).

---

### Task 2: AxiVale — `parseChatLink` client method

**Repo:** `/var/home/mstephens/Documents/GitHub/axivale` (branch `meta-phase2a` for all AxiVale tasks)
**Files:**
- Modify: `src/main/axiforgeClient.ts`
- Test: `src/main/axiforgeClient.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/main/axiforgeClient.test.ts`, mirror the existing `parseGw2Skills` client test. Add:
```ts
  it('parseChatLink POSTs the link + gameMode to /import/chat-link/parse', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ profession: 'Guardian', title: null })
    })
    const client = new AxiforgeClient(/* mirror how other tests construct it, incl. fetch injection */ fetchMock as never)
    const build = await client.parseChatLink({ link: '[&DQEAAA==]', gameMode: 'wvw' })
    expect(build).toEqual({ profession: 'Guardian', title: null })
    const [method, path, body] = callOf(fetchMock) // mirror the existing test's assertion style
    expect(path).toContain('/import/chat-link/parse')
    expect(body).toMatchObject({ link: '[&DQEAAA==]', gameMode: 'wvw' })
  })
```
IMPORTANT: match this file's existing construction + assertion pattern for `parseGw2Skills` exactly (how it injects fetch, how it reads the request path/body). Adapt the snippet to that pattern rather than the placeholder `callOf`.

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/axiforgeClient.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** in `src/main/axiforgeClient.ts`, right after `parseGw2Skills` (line 306):
```ts
  /**
   * Decode an in-game build template chat code into a structured build WITHOUT
   * saving it (read-only preview). Like parseGw2Skills but for a raw chat code;
   * routes through request() so a closed AxiForge surfaces AxiforgeNotRunningError.
   */
  parseChatLink(opts: { link: string; gameMode?: string }): Promise<ForgeBuild> {
    const body: { link: string; gameMode?: string } =
      opts.gameMode !== undefined ? { link: opts.link, gameMode: opts.gameMode } : { link: opts.link }
    return this.request('POST', '/import/chat-link/parse', body)
  }
```

- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/main/axiforgeClient.test.ts --maxWorkers=2`; `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add src/main/axiforgeClient.ts src/main/axiforgeClient.test.ts
git commit -m "feat(axiforge): parseChatLink client (no-save chat-code decode)"
```

---

### Task 3: AxiVale — `gw2_build_card` tool

**Files:**
- Modify: `src/main/tools/axiforge.ts`
- Test: `src/main/tools/axiforge.test.ts`, `src/main/tools/inventory.test.ts`

- [ ] **Step 1: Write the failing test.** In `src/main/tools/axiforge.test.ts`, mirror the existing `gw2skills_parse` tool test. Add (adapt to the file's existing `deps`/tool-lookup helpers):
```ts
  it('gw2_build_card decodes a chat code into a build-card display', async () => {
    const parseChatLink = vi.fn().mockResolvedValue({ profession: 'Guardian', title: 'Heal FB', images: { x: 'BIG' } })
    const tools = buildAxiforgeTools(makeDeps({ parseChatLink })) // mirror how this file builds deps + overrides axiforge methods
    const t = tools.find((x) => x.name === 'gw2_build_card')!
    const res = await t.handler({ chat_code: '[&DQEAAA==]', game_mode: 'wvw' }, {})
    expect(parseChatLink).toHaveBeenCalledWith({ link: '[&DQEAAA==]', gameMode: 'wvw' })
    expect(res.display).toEqual({ kind: 'build-card', data: { build: { profession: 'Guardian', title: 'Heal FB', images: { x: 'BIG' } } } })
    // model value is image-stripped
    const value = JSON.parse(res.content[0].text)
    expect(value.images).toBeUndefined()
  })
```
(Use this file's existing helpers — how it constructs `deps` with a fake `axiforge` client and how it asserts `display`/`content`. The key assertions: `parseChatLink` called with `{link, gameMode}`, a `build-card` display with the full build, and the model `value` image-stripped.)

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/main/tools/axiforge.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement.** In `src/main/tools/axiforge.ts`, add this tool to the array returned by `buildAxiforgeTools`, right after the `gw2skills_parse` tool (after line 239). It reuses the same `write` helper + `stripImages` already defined in this file:
```ts
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
```

- [ ] **Step 4: Update the inventory snapshot.** In `src/main/tools/inventory.test.ts`, add `'gw2_build_card'` to the expected sorted tool-name list (alphabetical: `gw2_build_card` sorts before `gw2_guild_*`/`gw2_wiki_facts`/`gw2skills_parse` — place per the file's sort).

- [ ] **Step 5: Run, expect PASS:** `npx vitest run src/main/tools/axiforge.test.ts src/main/tools/inventory.test.ts --maxWorkers=2`; `npm run typecheck`.

- [ ] **Step 6: Commit**
```bash
git add src/main/tools/axiforge.ts src/main/tools/axiforge.test.ts src/main/tools/inventory.test.ts
git commit -m "feat(meta): gw2_build_card tool (chat code -> build card)"
```

---

### Task 4: AxiVale — prompt guidance

**Files:**
- Modify: `src/main/agent.ts`

- [ ] **Step 1: Add the bullet** to `AXIVALE_SYSTEM_PROMPT`, right after the `meta_search` "Meta depth" bullet (each sentence on ONE line — prompt regex tests match exact phrases):
```
- When meta_search surfaces a build that includes an in-game chat code ([&...], common on MetaBattle), you may call gw2_build_card with that code to render the exact build card.
  Place it inline with a {{figure}} marker to illustrate a specific recommended build; do not dump a card for every build.
```

- [ ] **Step 2: Verify prompt tests still pass:** `npx vitest run src/main/agent.test.ts --maxWorkers=2`; `npm run typecheck`.

- [ ] **Step 3: Commit**
```bash
git add src/main/agent.ts
git commit -m "feat(meta): prompt guidance for gw2_build_card inline cards"
```

---

### Task 5: Full verification

- [ ] **Step 1: AxiForge tests** — in `/home/mstephens/Documents/GitHub/axiforge`, run `npx jest tests/unit/localApi.test.js` → PASS.
- [ ] **Step 2: AxiVale full suite** — `npx vitest run --maxWorkers=2` → PASS.
- [ ] **Step 3: AxiVale typecheck + build** — `npm run typecheck` PASS; `npm run build` PASS.
- [ ] **Step 4: Manual smoke test (controller; needs AxiForge installed).** Restart AxiForge dev (or let the launcher auto-start it) so the new endpoint is live. In AxiVale, ask for a specific MetaBattle build (e.g. "show me the meta Heal Firebrand build for WvW"). Confirm: the AI pulls a `[&…]` code from meta_search, `gw2_build_card` fires (AxiForge auto-starts), a correct build card renders inline, and NO new build appears in the AxiForge library. Ask with a garbage code → clean error.

---

## Self-Review

**Spec coverage:**
- AxiForge no-save `parseChatLink` op + `POST /import/chat-link/parse` route + IPC handler (decode via existing `decodeChatLinkToBuild`, no upsert) → Task 1. ✔
- `AxiforgeClient.parseChatLink({link, gameMode?})` mirroring `parseGw2Skills` → Task 2. ✔
- `gw2_build_card({chat_code, game_mode?})` tool: `write()`-wrapped `parseChatLink`, `safeRich` build-card display, `stripImages` on model value, non-destructive, registered → Task 3. ✔
- Reuses build-card pipeline (no renderer changes) → inherent (Task 3 emits `{kind:'build-card'}`). ✔
- Prompt bullet (chat code from meta_search, inline via {{figure}}) → Task 4. ✔
- Error handling (bad code → safeRich error; AxiForge down → write()/ensureRunning → AxiforgeError) → inherent in Task 3 reuse. ✔
- Testing: AxiForge route test, client test, tool test, inventory snapshot; real round-trip = manual smoke → Tasks 1/2/3/5. ✔
- Scope MetaBattle-only; no library pollution (no upsert) → Task 1 handler comment + smoke test. ✔

**Placeholder scan:** none — full code in each step. Two tests (Task 2 client, Task 3 tool) say "mirror the existing file's pattern" with the key assertions spelled out, because the exact fetch-injection/deps-construction helpers must match each test file's conventions; the asserted behavior is concrete.

**Type consistency:** `parseChatLink({link, gameMode?}) → ForgeBuild` is consistent across AxiForge route (`body.link`/`body.gameMode`), the client method (Task 2), and the tool call site (Task 3, `{link: chat_code, gameMode: game_mode}`). `build-card` display shape matches the existing `DisplayPayload` union and `gw2skills_parse`'s usage. `stripImages` + `write` are the existing helpers in `tools/axiforge.ts`.
