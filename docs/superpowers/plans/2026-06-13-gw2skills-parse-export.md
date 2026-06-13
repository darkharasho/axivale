# gw2skills Parse + Build Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only gw2skills.net **parse** path (decode a link to a structured build without saving, so the agent can explain/critique/compare it) and surface AxiForge's existing build **chat-link export** as an AxiVale tool. This is Part B (+ the gw2skills/export lines of Part C) of the 2026-06-13 Discord-history + gw2skills design spec. Part A (Discord history/search) is a separate plan.
**Working directories:** /var/home/mstephens/Documents/GitHub/axiforge (parse refactor + local API), /var/home/mstephens/Documents/GitHub/axivale (client/tools/prompt)
**Architecture:** AxiForge's `importGw2SkillsBuild(url, name, folderId, gameMode)` currently fetches the page, decodes the chat link, maps equipment, and returns a build object that the IPC/local-API layer then upserts. We extract `parseGw2Skills(url, { name?, gameMode? })` — everything up to and including the assembled build object — so `importGw2SkillsBuild` becomes `parseGw2Skills(...)` (no save). A new `POST /import/gw2skills/parse` route returns that object without writing the store, wired through the `ops`/`invokeLocal` registry exactly like the existing `/import/gw2skills`. On the AxiVale side, `AxiforgeClient.parseGw2Skills` POSTs the new endpoint; because the parse needs AxiForge's live catalog, the tool routes through the same `write()`/`ensureRunning` auto-spawn wrapper used by mutations (it is *not* destructive). The `gw2skills_parse` tool returns the compact (image-stripped) build plus a `build-card` display; `axiforge_build_chat_link` wraps the already-existing `AxiforgeClient.buildChatLink`.
**Tech Stack:** AxiForge — Node CommonJS, Jest (`npx jest`). AxiVale — Electron + TypeScript, Vitest forks pool capped at 2 workers (`npx vitest run <file> --maxWorkers=2`).

---

## File Structure

```
axiforge/
  src/main/
    gw2skillsImport.js        # EXTRACT parseGw2Skills; importGw2SkillsBuild delegates to it (Task 1)
    localApi.js               # ADD POST /import/gw2skills/parse route (Task 2)
    index.js                  # ADD ops.parseGw2skills + handler wiring (Task 2)
  tests/unit/
    gw2skillsImport.test.js   # ADD parseGw2Skills tests (no store write) (Task 1)
    localApi.test.js          # ADD /import/gw2skills/parse route test (Task 2)

axivale/
  src/main/
    axiforgeClient.ts         # ADD parseGw2Skills() method (Task 3)
    agent.ts                  # ADD gw2skills parse-vs-import + chat-link guidance (Task 5)
    axiforgeClient.test.ts    # ADD parseGw2Skills client test (Task 3)
    systemPrompt.test.ts      # ADD prompt assertions (Task 5)
    tools/
      axiforge.ts             # ADD gw2skills_parse + axiforge_build_chat_link tools (Task 4)
      axiforge.test.ts        # ADD tool tests (Task 4)
      inventory.test.ts       # UPDATE expected inventory (+2) (Task 4)
```

---

## Key facts confirmed from the real source (do not re-derive)

- `importGw2SkillsBuild` (axiforge/src/main/gw2skillsImport.js, lines ~434–593) **never** touches the store — it `return`s a build object. The store write happens in `index.js` and `localApi.js`'s `ops`. So "extract parse from save" means: rename the current body to `parseGw2Skills(url, { name, gameMode })`, keep `importGw2SkillsBuild` as a thin alias that calls it (preserving the `(url, name, folderId, gameMode)` positional signature used by the IPC handler `builds:import-gw2skills`). The `folderId` is threaded only through `decodeChatLinkToBuild`; `parseGw2Skills` keeps accepting it.
- `gw2skillsImport.js` `module.exports` currently exports `importGw2SkillsBuild` + 7 `_`-prefixed test helpers. We **add** `parseGw2Skills` to that export object; we do not remove anything.
- The existing Jest test (`tests/unit/gw2skillsImport.test.js`) only exercises the pure helpers (`_parsePreloadFromHtml`, `_buildStatLookup`, etc.) — it never calls `importGw2SkillsBuild` (that does live HTTPS fetches). So there is **no fetch/db stub to mirror**: our new `parseGw2Skills` test must mock the network the same way nothing currently does — i.e. we test `parseGw2Skills` by stubbing its three async inputs (`httpsGet`, `_fetchDb`, `getUpgradeCatalog`, `decodeChatLinkToBuild`) via `jest.mock`. Plan Task 1 does exactly this and asserts the store is never called (there is no store import in the module, so "does not save" is structurally guaranteed — the test documents it by asserting the returned object shape and that the function has no `upsert`/store dependency).
- `localApi.js` `buildRoutes({ version, ops })` (lines 100–239): the existing import routes live in the "── Imports ──" block (lines 207–225). `ops.importGw2Skills(url, name, folderId, gameMode)`. We add `ops.parseGw2skills(url, gameMode)` and a `POST /import/gw2skills/parse` route beside it.
- `index.js`: `handle(channel, fn)` registers an IPC handler AND records it for `invokeLocal` (lines 290–301). `asHttpResult(promise, { badInput })` maps errors to HTTP statuses (lines 307–320). The `ops` object is built at lines 1974–1995. Existing: `importGw2Skills: (url, name, folderId, gameMode) => asHttpResult(invokeLocal("builds:import-gw2skills", ...), { badInput: true })`. We add a new IPC handler `builds:parse-gw2skills` (near the existing `builds:import-gw2skills` at lines 882–886) and a new op `parseGw2skills`.
- `localApi.test.js` uses a `stubOps(overrides)` factory (lines 12–32) — add `parseGw2Skills: async () => ({})` to the stub defaults, then a focused test in the "import endpoints" describe block.
- AxiVale `AxiforgeClient.request<T>` (axiforgeClient.ts lines 134–174) already re-reads discovery on 401 and converts not-running/timeouts to `AxiforgeNotRunningError`. `importGw2skills` (lines 292–294) is the template for `parseGw2Skills`. `buildChatLink(id)` already exists (lines 231–233) → `{ chatLink }`.
- AxiVale `tools/axiforge.ts`: `write()` (lines 43–60) auto-spawns AxiForge and retries once on `AxiforgeNotRunningError`. `safeRich` attaches a `display` payload; `stripImages` (lines 24–36). `AXIFORGE_DESTRUCTIVE_TOOLS` (lines 7–12) — neither new tool joins it. `axiforge_builds_get` (lines 82–94) is the `build-card` + `stripImages` template.
- AxiVale tool count: `axiforge.test.ts` asserts "13 axiforge tools"; after this plan it is **15**. `inventory.test.ts` lists every tool alphabetically — add `axiforge_build_chat_link` and `gw2skills_parse`.

---

## Task 1 — AxiForge: extract `parseGw2Skills` (no save)

**Repo:** /var/home/mstephens/Documents/GitHub/axiforge

### 1a. Write the failing test

- [ ] Add a `parseGw2Skills` describe block to `tests/unit/gw2skillsImport.test.js`. It mocks the module's three network/decoder dependencies so no real HTTPS happens, then asserts `parseGw2Skills` returns a complete assembled build and never writes a store. Append the following to the END of the file:

```js
// ── parseGw2Skills (read-only assembly; no store write) ───────────────────────

describe("parseGw2Skills", () => {
  const HTML = `
    <script>
    var SI = null;
    E = new BuildEditor({
      version: "9.1.2",
      dbid: 1772970067,
      showinfo: SI || undefined,
      preload: {
        chatlink: "DQYfHSkb",
        mode: "wvw",
        weapon: [0, 0, 0, 0, 0, 0],
        equipment: {
          weapon: {}, armor: {}, trinket: {},
          buff: { food: 534, utility: 40 },
          relic: 0
        },
        extra: [0, 0, 0, 0, 0, 0]
      }
    });
    </script>`;

  // Minimal db json with the tables _buildStatLookup / upgrade / buff / weapon read.
  const DB = {
    profile:  { desc: ["id", "img", "profile", "name"], rows: [] },
    prfltype: { desc: ["id", "key", "name"], rows: [] },
    upgrade:  { desc: ["id", "img", "x", "type", "name"], rows: [] },
    buff:     { desc: ["id", "img", "x", "y", "z", "name"],
                rows: [[534, "j", 5, 80, 1, "Cilantro Lime Sous-Vide Steak"],
                       [40,  "b", 5, 80, 2, "Toxic Focusing Crystal"]] },
    weapon:   { desc: ["id", "key", "type"], rows: [] },
  };

  const UPGRADE_CATALOG = {
    runes: [], sigils: [], infusions: [], enrichments: [],
    foods: [{ id: 1234, name: "Cilantro Lime Sous-Vide Steak" }],
    utilities: [{ id: 5678, name: "Toxic Focusing Crystal" }],
  };

  // The decoded build template the chat link would produce.
  const BUILD_TEMPLATE = {
    title: "My WvW Build",
    profession: "Guardian",
    specializations: [{ id: 16, name: "Radiance", elite: false }],
    skills: { heal: { id: 9158 }, utility: [null, null, null], elite: null },
    equipment: { weapons: {} },
  };

  let mod;
  let httpsCalls;
  let decodeCalls;

  beforeEach(() => {
    jest.resetModules();
    httpsCalls = [];
    decodeCalls = [];

    // https.request → return our fixed HTML / db json based on the requested path.
    jest.doMock("https", () => ({
      request: (opts, cb) => {
        const path = opts.path || "";
        httpsCalls.push(path);
        const body = path.includes("/ajax/db/") ? JSON.stringify(DB) : HTML;
        const res = {
          statusCode: 200,
          headers: {},
          on: (ev, fn) => {
            if (ev === "data") fn(body);
            if (ev === "end") fn();
            return res;
          },
        };
        cb(res);
        return { on: () => {}, end: () => {}, destroy: () => {} };
      },
    }));

    jest.doMock("../../src/main/buildChatLink.js", () => ({
      decodeChatLinkToBuild: (link, name, folderId, gameMode) => {
        decodeCalls.push({ link, name, folderId, gameMode });
        return Promise.resolve({ ...BUILD_TEMPLATE, title: name || BUILD_TEMPLATE.title });
      },
    }));

    jest.doMock("../../src/main/gw2Data", () => ({
      getUpgradeCatalog: () => Promise.resolve(UPGRADE_CATALOG),
    }));

    mod = require("../../src/main/gw2skillsImport");
  });

  afterEach(() => {
    jest.dontMock("https");
    jest.dontMock("../../src/main/buildChatLink.js");
    jest.dontMock("../../src/main/gw2Data");
    jest.resetModules();
  });

  it("returns a complete assembled build object without saving it", async () => {
    const build = await mod.parseGw2Skills("https://gw2skills.net/editor/?abc", {
      name: "My WvW Build",
    });
    // Carries the decoded template fields through
    expect(build.profession).toBe("Guardian");
    expect(build.title).toBe("My WvW Build");
    expect(Array.isArray(build.specializations)).toBe(true);
    // Game mode comes from preload.mode ("wvw") here, overriding the gameMode opt
    expect(build.gameMode).toBe("wvw");
    // Equipment was assembled (resolved buff name → catalog id)
    expect(build.equipment.food).toBe("1234");
    expect(build.equipment.utility).toBe("5678");
    // Amalgam morph ids present (all zero here)
    expect(build.morphSkillIds).toEqual([0, 0, 0]);
  });

  it("passes name/folderId/gameMode through to the chat-link decoder", async () => {
    await mod.parseGw2Skills("https://gw2skills.net/editor/?abc", {
      name: "Named",
      folderId: "folder-7",
      gameMode: "pve",
    });
    // preload.mode is "wvw" so the decoder receives the resolved "wvw" mode
    expect(decodeCalls[0]).toMatchObject({ name: "Named", folderId: "folder-7", gameMode: "wvw" });
  });

  it("falls back to the gameMode option when preload.mode is unset", async () => {
    // Re-mock https to emit HTML whose preload has no mode field.
    jest.dontMock("https");
    jest.resetModules();
    const htmlNoMode = HTML.replace('mode: "wvw",', "");
    jest.doMock("https", () => ({
      request: (opts, cb) => {
        const path = opts.path || "";
        const body = path.includes("/ajax/db/") ? JSON.stringify(DB) : htmlNoMode;
        const res = {
          statusCode: 200, headers: {},
          on: (ev, fn) => { if (ev === "data") fn(body); if (ev === "end") fn(); return res; },
        };
        cb(res);
        return { on: () => {}, end: () => {}, destroy: () => {} };
      },
    }));
    jest.doMock("../../src/main/buildChatLink.js", () => ({
      decodeChatLinkToBuild: () => Promise.resolve({ ...BUILD_TEMPLATE, equipment: { weapons: {} } }),
    }));
    jest.doMock("../../src/main/gw2Data", () => ({
      getUpgradeCatalog: () => Promise.resolve(UPGRADE_CATALOG),
    }));
    const mod2 = require("../../src/main/gw2skillsImport");
    const build = await mod2.parseGw2Skills("https://gw2skills.net/editor/?abc", { gameMode: "pve" });
    expect(build.gameMode).toBe("pve");
  });
});
```

- [ ] Run, expecting failure (`parseGw2Skills` is not exported yet):

```
cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit/gw2skillsImport.test.js
```

Expected: the new `parseGw2Skills` describe fails — `TypeError: mod.parseGw2Skills is not a function`. The existing helper describes still pass.

### 1b. Implement the extraction

- [ ] In `src/main/gw2skillsImport.js`, replace the `importGw2SkillsBuild` function (currently lines ~434–593) with a `parseGw2Skills` function carrying the identical body, plus a thin `importGw2SkillsBuild` alias that preserves the old positional signature. Replace this:

```js
async function importGw2SkillsBuild(url, name, folderId, gameMode) {
  // Normalize to English site
  const normalizedUrl = url.replace(/^https?:\/\/(?:www\.)?gw2skills\.net/, "https://en.gw2skills.net");
```

with:

```js
/**
 * Fetch and decode a gw2skills.net editor URL into an axiforge build object.
 * READ-ONLY: returns the assembled (normalize-ready) build; never writes a store.
 *
 * @param {string} url  full gw2skills.net editor URL
 * @param {{ name?: string, folderId?: (string|null), gameMode?: string }} [opts]
 * @returns {Promise<object>} the assembled axiforge build object (not saved)
 */
async function parseGw2Skills(url, opts = {}) {
  const { name = null, folderId = null, gameMode } = opts;
  // Normalize to English site
  const normalizedUrl = url.replace(/^https?:\/\/(?:www\.)?gw2skills\.net/, "https://en.gw2skills.net");
```

The rest of the function body (from `const { preload, dbid } = ...` down through the final `return { ...buildTemplate, equipment: finalEquipment, gameMode: buildGameMode, morphSkillIds };`) is **unchanged** — it already references `name`, `folderId`, and `gameMode` as locals, which are now destructured from `opts`. The closing `}` of the function stays.

- [ ] Immediately AFTER the closing `}` of `parseGw2Skills`, add the backward-compatible alias (keeps the IPC handler `builds:import-gw2skills` and existing tests calling the positional form working):

```js
/**
 * Backward-compatible positional wrapper around parseGw2Skills.
 * The store write is performed by the caller (IPC handler / local-API op),
 * not here — parse and import return the same object; only the caller differs.
 *
 * @param {string}      url
 * @param {string}      name
 * @param {string|null} folderId
 * @param {string}      gameMode
 * @returns {Promise<object>} assembled axiforge build object
 */
async function importGw2SkillsBuild(url, name, folderId, gameMode) {
  return parseGw2Skills(url, { name, folderId, gameMode });
}
```

- [ ] Update the `module.exports` block at the bottom of the file to export `parseGw2Skills` alongside the existing names:

```js
module.exports = {
  importGw2SkillsBuild,
  parseGw2Skills,
  // Exported for unit tests
  _parsePreloadFromHtml,
  _buildStatLookup,
  _normalizeStatName,
  _lookupUpgradeName,
  _lookupBuffName,
  _mapEquipment,
  _extractMorphSkillIds,
};
```

- [ ] Run, expecting pass:

```
cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit/gw2skillsImport.test.js
```

Expected: all describes pass, including the three new `parseGw2Skills` cases.

### 1c. Commit

- [ ] Commit:

```
cd /var/home/mstephens/Documents/GitHub/axiforge && git add -A && git commit -m "$(cat <<'EOF'
refactor(gw2skills): extract parseGw2Skills(url, opts) from importGw2SkillsBuild

Read-only parse returns the assembled build object without saving; the
positional importGw2SkillsBuild now delegates to it. No behavior change to
import (the store write was already in the caller, not this module).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — AxiForge local API: `POST /import/gw2skills/parse`

**Repo:** /var/home/mstephens/Documents/GitHub/axiforge

### 2a. Write the failing route test

- [ ] In `tests/unit/localApi.test.js`, add `parseGw2Skills` to the `stubOps` defaults (so every other describe block keeps working). Change:

```js
    importChatLink: async () => ({}),
    importGw2Skills: async () => ({}),
```

to:

```js
    importChatLink: async () => ({}),
    importGw2Skills: async () => ({}),
    parseGw2Skills: async () => ({}),
```

- [ ] In the existing `describe("local API — import endpoints", ...)` block, extend the `beforeEach` override and add tests. Change the `beforeEach` overrides object (currently `importChatLink` + `importGw2Skills`) to also capture parse calls. Replace:

```js
      importGw2Skills: async (url, name, folderId, gameMode) => {
        importedGw2Skills.push({ url, name, folderId, gameMode });
        return { id: "imported-2", title: name || "Imported Build", gameMode: gameMode || "pve" };
      },
    }));
```

with:

```js
      importGw2Skills: async (url, name, folderId, gameMode) => {
        importedGw2Skills.push({ url, name, folderId, gameMode });
        return { id: "imported-2", title: name || "Imported Build", gameMode: gameMode || "pve" };
      },
      parseGw2Skills: async (url, gameMode) => {
        parsedGw2Skills.push({ url, gameMode });
        return { id: undefined, profession: "Guardian", gameMode: gameMode || "pve", equipment: {} };
      },
    }));
```

- [ ] Add the `parsedGw2Skills` capture array near the other `const ...Gw2Skills = []` declarations in that describe, and reset it in the `beforeEach`. Change:

```js
  const importedChatLinks = [];
  const importedGw2Skills = [];

  beforeEach(async () => {
    importedChatLinks.length = 0;
    importedGw2Skills.length = 0;
```

to:

```js
  const importedChatLinks = [];
  const importedGw2Skills = [];
  const parsedGw2Skills = [];

  beforeEach(async () => {
    importedChatLinks.length = 0;
    importedGw2Skills.length = 0;
    parsedGw2Skills.length = 0;
```

- [ ] Add these tests at the END of the import-endpoints describe (after the existing `"POST /import/gw2skills requires a url"` test, before its closing `});`):

```js
  test("POST /import/gw2skills/parse returns the parsed build (not saved) and forwards url + gameMode", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills/parse", {
      url: "http://gw2skills.net/editor/?ABC",
      gameMode: "wvw",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profession).toBe("Guardian");
    expect(body.gameMode).toBe("wvw");
    expect(parsedGw2Skills).toEqual([{ url: "http://gw2skills.net/editor/?ABC", gameMode: "wvw" }]);
  });

  test("POST /import/gw2skills/parse defaults gameMode to undefined when omitted", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills/parse", {
      url: "http://gw2skills.net/editor/?ABC",
    });
    expect(res.status).toBe(200);
    expect(parsedGw2Skills).toEqual([{ url: "http://gw2skills.net/editor/?ABC", gameMode: undefined }]);
  });

  test("POST /import/gw2skills/parse requires a url", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills/parse", {});
    expect(res.status).toBe(400);
    expect(parsedGw2Skills).toHaveLength(0);
  });
```

- [ ] Run, expecting failure (route does not exist → 404, not 200/400):

```
cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit/localApi.test.js
```

Expected: the three new `/import/gw2skills/parse` tests fail (status 404). All existing tests pass (the `stubOps` default addition is harmless).

### 2b. Implement the route

- [ ] In `src/main/localApi.js`, add the parse route inside the "── Imports ──" block, immediately after the existing `POST /import/gw2skills` route (after its closing `},`):

```js
    {
      method: "POST", pattern: "/import/gw2skills/parse",
      handler: async ({ body }) => {
        if (!body?.url || typeof body.url !== "string") {
          throw httpError(400, "Body must include a gw2skills editor URL: { url }");
        }
        return ops.parseGw2skills(body.url, body.gameMode ?? undefined);
      },
    },
```

> Note: `matchRoute` matches by segment count + literal segments in declaration order. `/import/gw2skills/parse` (3 segments) cannot be shadowed by `/import/gw2skills` (2 segments), so order between them does not matter.

### 2c. Wire the op + IPC handler in index.js

- [ ] In `src/main/index.js`, add an IPC handler beside the existing `builds:import-gw2skills` handler (currently lines 882–886). After that handler's closing `});`, add:

```js
  handle("builds:parse-gw2skills", async (_e, url, gameMode) => {
    const { parseGw2Skills } = require("./gw2skillsImport.js");
    return parseGw2Skills(url, { gameMode });
  });
```

- [ ] In the `ops` object passed to `createLocalApi` (lines 1974–1995), add the `parseGw2skills` op directly after the existing `importGw2Skills` op:

```js
      importGw2Skills: (url, name, folderId, gameMode) =>
        asHttpResult(invokeLocal("builds:import-gw2skills", url, name, folderId, gameMode), { badInput: true }),
      parseGw2skills: (url, gameMode) =>
        asHttpResult(invokeLocal("builds:parse-gw2skills", url, gameMode), { badInput: true }),
```

> `badInput: true` means a parse failure on a bad gw2skills link surfaces as HTTP 400 (mapped by `asHttpResult`), which the AxiVale client turns into an `AxiforgeError` with the message — matching the spec's "couldn't read that gw2skills link" friendly-error requirement.

- [ ] Run the route test, expecting pass:

```
cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit/localApi.test.js
```

Expected: all import-endpoint tests pass, including the three new parse tests.

### 2d. Commit

- [ ] Commit:

```
cd /var/home/mstephens/Documents/GitHub/axiforge && git add -A && git commit -m "$(cat <<'EOF'
feat(api): POST /import/gw2skills/parse returns a parsed build without saving

Wires ops.parseGw2skills through the same invokeLocal/asHttpResult registry as
the existing import route; a bad link surfaces as HTTP 400.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — AxiVale client: `parseGw2Skills({ url, gameMode? })`

**Repo:** /var/home/mstephens/Documents/GitHub/axivale

### 3a. Write the failing test

- [ ] In `src/main/axiforgeClient.test.ts`, add a test in the `describe('API path', ...)` block, right after the existing `'importChatLink and importGw2skills post to the import endpoints'` test:

```ts
  it('parseGw2Skills posts to the parse endpoint and returns the build (no save)', async () => {
    const port = await startStub({
      'POST /import/gw2skills/parse': { json: { profession: 'Guardian', gameMode: 'wvw', equipment: {} } }
    })
    writeDiscovery(port)
    const build = await makeClient().parseGw2Skills({ url: 'http://gw2skills.net/editor/?abc', gameMode: 'wvw' })
    expect(build).toMatchObject({ profession: 'Guardian', gameMode: 'wvw' })
    expect(JSON.parse(requests[0].body)).toEqual({ url: 'http://gw2skills.net/editor/?abc', gameMode: 'wvw' })
  })

  it('parseGw2Skills omits gameMode from the body when not given', async () => {
    const port = await startStub({
      'POST /import/gw2skills/parse': { json: { profession: 'Ranger', gameMode: 'pve' } }
    })
    writeDiscovery(port)
    await makeClient().parseGw2Skills({ url: 'http://gw2skills.net/editor/?abc' })
    expect(JSON.parse(requests[0].body)).toEqual({ url: 'http://gw2skills.net/editor/?abc' })
  })

  it('parseGw2Skills surfaces a 400 from a bad link as AxiforgeError', async () => {
    const port = await startStub({
      'POST /import/gw2skills/parse': { status: 400, json: { error: "Couldn't read that gw2skills link" } }
    })
    writeDiscovery(port)
    const err = await makeClient().parseGw2Skills({ url: 'http://bad' }).catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err.message).toContain('gw2skills link')
  })
```

- [ ] Run, expecting failure (`parseGw2Skills` is not a method yet):

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/axiforgeClient.test.ts --maxWorkers=2
```

Expected: the three new tests fail with a TypeScript/runtime error (`parseGw2Skills is not a function`).

### 3b. Implement the client method

- [ ] In `src/main/axiforgeClient.ts`, in the "--- folders / imports ---" section, add the method directly after `importGw2skills` (after its closing `}` at line ~294):

```ts
  /**
   * Decode a gw2skills.net editor URL into a structured build WITHOUT saving it
   * (read-only preview/critique). Routes through request() — which converts a
   * closed AxiForge into AxiforgeNotRunningError — because parsing needs
   * AxiForge's live catalog. Returns the assembled build object.
   */
  parseGw2Skills(opts: { url: string; gameMode?: string }): Promise<ForgeBuild> {
    const body: { url: string; gameMode?: string } =
      opts.gameMode !== undefined ? { url: opts.url, gameMode: opts.gameMode } : { url: opts.url }
    return this.request('POST', '/import/gw2skills/parse', body)
  }
```

- [ ] Run, expecting pass:

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/axiforgeClient.test.ts --maxWorkers=2
```

Expected: all `axiforgeClient.test.ts` tests pass.

### 3c. Commit

- [ ] Commit:

```
cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "$(cat <<'EOF'
feat(axiforge-client): parseGw2Skills posts the read-only parse endpoint

Returns the assembled build without saving; routes through request() so a
closed AxiForge becomes AxiforgeNotRunningError (parsing needs the live catalog).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — AxiVale tools: `gw2skills_parse` + `axiforge_build_chat_link`

**Repo:** /var/home/mstephens/Documents/GitHub/axivale

### 4a. Update the failing inventory + tool tests

- [ ] In `src/main/tools/inventory.test.ts`, add the two new tool names to the expected sorted inventory. Insert `'axiforge_build_chat_link'` immediately before `'axiforge_build_publish'`, and `'gw2skills_parse'` after `'gw2_guild_members'` (alphabetical order). The relevant slices become:

```ts
      'axiforge_build_chat_link',
      'axiforge_build_publish',
      'axiforge_builds_delete',
```

and at the end of the array (after the gw2 tools):

```ts
      'gw2_account_info',
      'gw2_api',
      'gw2_guild_log',
      'gw2_guild_members',
      'gw2skills_parse'
    ])
```

- [ ] In `src/main/tools/axiforge.test.ts`, bump the count test from 13 to 15 and assert the new names. Change:

```ts
  it('registers all 13 axiforge tools', () => {
```

to:

```ts
  it('registers all 15 axiforge tools', () => {
```

and add the two names to that test's `for (const n of [ ... ])` list (after `'axiforge_import_gw2skills'`):

```ts
      'axiforge_import_gw2skills',
      'gw2skills_parse',
      'axiforge_build_chat_link',
      'axiforge_catalog'
```

- [ ] Add `parseGw2Skills` and `buildChatLink` to the `makeDeps()` axiforge stub in `axiforge.test.ts`. After the `catalogUpgrades: vi.fn()...` line, add:

```ts
      catalogUpgrades: vi.fn().mockResolvedValue([{ id: 24836 }]),
      buildChatLink: vi.fn().mockResolvedValue({ chatLink: '[&DQEK...]' }),
      parseGw2Skills: vi.fn().mockResolvedValue({
        title: 'Parsed Build',
        profession: 'Guardian',
        gameMode: 'wvw',
        equipment: {},
        images: { icon: 'data:image/png;base64,abc123' }
      })
```

> (Replace the existing trailing `catalogUpgrades: vi.fn().mockResolvedValue([{ id: 24836 }])` line — which currently has no trailing comma — with the comma'd version above plus the two new fields.)

- [ ] Add behavior tests at the END of the top-level `describe('axiforge tools', ...)` block (before its final `})`):

```ts
  describe('gw2skills_parse', () => {
    it('returns the parsed build (images stripped) and attaches a build-card display', async () => {
      const deps = makeDeps()
      const result = await find(deps, 'gw2skills_parse').handler(
        { url: 'http://gw2skills.net/editor/?abc', game_mode: 'wvw' },
        {}
      )
      expect(deps.axiforge.parseGw2Skills).toHaveBeenCalledWith({
        url: 'http://gw2skills.net/editor/?abc',
        gameMode: 'wvw'
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).not.toContain('data:image/')
      const parsed = JSON.parse(text)
      expect(parsed.profession).toBe('Guardian')
      expect(parsed.images).toBeUndefined()
      expect(parsed.imageKeys).toEqual(['icon'])
      // Full build (images intact) goes to the card.
      expect(result.display).toMatchObject({ kind: 'build-card' })
      expect(result.isError).toBeUndefined()
    })

    it('omits game_mode from the client call when not provided', async () => {
      const deps = makeDeps()
      await find(deps, 'gw2skills_parse').handler({ url: 'http://gw2skills.net/editor/?abc' }, {})
      expect(deps.axiforge.parseGw2Skills).toHaveBeenCalledWith({ url: 'http://gw2skills.net/editor/?abc' })
    })

    it('auto-spawns AxiForge and retries once when it is closed (parse needs the catalog)', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.parseGw2Skills as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new AxiforgeNotRunningError())
        .mockResolvedValueOnce({ title: 'Parsed', profession: 'Guardian', equipment: {} })
      const result = await find(deps, 'gw2skills_parse').handler(
        { url: 'http://gw2skills.net/editor/?abc' },
        {}
      )
      expect(deps.axiforgeLauncher.ensureRunning).toHaveBeenCalledTimes(1)
      expect(deps.axiforge.parseGw2Skills).toHaveBeenCalledTimes(2)
      expect(result.isError).toBeUndefined()
    })

    it('never throws: a parse error comes back as an error result', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.parseGw2Skills as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AxiforgeError("Couldn't read that gw2skills link")
      )
      const result = await find(deps, 'gw2skills_parse').handler({ url: 'http://bad' }, {})
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('gw2skills link')
    })

    it('is not destructive', () => {
      expect(DESTRUCTIVE_TOOLS).not.toContain('gw2skills_parse')
    })
  })

  describe('axiforge_build_chat_link', () => {
    it('returns the chat link for a build id', async () => {
      const deps = makeDeps()
      const result = await find(deps, 'axiforge_build_chat_link').handler({ build_id: 'b1' }, {})
      expect(deps.axiforge.buildChatLink).toHaveBeenCalledWith('b1')
      const parsed = JSON.parse((result.content[0] as { text: string }).text)
      expect(parsed.chatLink).toBe('[&DQEK...]')
      expect(result.isError).toBeUndefined()
    })

    it('surfaces an unknown-build error as an error result (never throws)', async () => {
      const deps = makeDeps()
      ;(deps.axiforge.buildChatLink as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AxiforgeError('Build not found: nope')
      )
      const result = await find(deps, 'axiforge_build_chat_link').handler({ build_id: 'nope' }, {})
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('Build not found')
    })

    it('is not destructive', () => {
      expect(DESTRUCTIVE_TOOLS).not.toContain('axiforge_build_chat_link')
    })
  })
```

- [ ] Run, expecting failure (tools not registered yet):

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools/axiforge.test.ts src/main/tools/inventory.test.ts --maxWorkers=2
```

Expected: the 15-count test, inventory test, and the new `gw2skills_parse` / `axiforge_build_chat_link` describes fail (`find(...)` returns `undefined`, `.handler` throws).

### 4b. Implement the two tools

- [ ] In `src/main/tools/axiforge.ts`, add both tools to the array returned by `buildAxiforgeTools`. Insert them immediately after the existing `axiforge_import_gw2skills` tool (after its closing `),`), before `axiforge_catalog`:

```ts
    tool(
      'gw2skills_parse',
      'Decode a gw2skills.net editor link into a structured build WITHOUT saving it — use this to explain, critique, or compare a build the user pasted. Returns the full build (profession, traits, skills, gear, runes/sigils/infusions, food, relic). Read-only; nothing is written to AxiForge. To actually rebuild the link in AxiForge instead, use axiforge_import_gw2skills. Parsing needs AxiForge’s catalog, so it starts AxiForge headless if it is closed. The user sees a build card for the parsed build; images (if any) are stripped from the model-visible JSON.',
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
      'axiforge_build_chat_link',
      'Generate the in-game build template chat code for an AxiForge build. The user can paste this code in Guild Wars 2 to load the build, or into gw2skills.net to view it. Read-only. Returns { chatLink }.',
      { build_id: z.string().describe('Build id from axiforge_builds_list') },
      safe(async ({ build_id }) => write(() => deps.axiforge.buildChatLink(build_id)))
    ),
```

> Both use `write()`: `axiforge_build_chat_link` because generating the link runs server-side in AxiForge (so it must be running), and `gw2skills_parse` because the parse needs the live catalog. `write()` only auto-spawns on `AxiforgeNotRunningError`; plain `AxiforgeError` (bad link, unknown build) passes through `safe`/`safeRich` to an error result without spawning. Neither is added to `AXIFORGE_DESTRUCTIVE_TOOLS`.

- [ ] Run, expecting pass:

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/tools/axiforge.test.ts src/main/tools/inventory.test.ts --maxWorkers=2
```

Expected: all tool + inventory tests pass.

### 4c. Commit

- [ ] Commit:

```
cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "$(cat <<'EOF'
feat(tools): add gw2skills_parse (read-only) and axiforge_build_chat_link

gw2skills_parse decodes a link to a structured build + build-card display
without saving; axiforge_build_chat_link surfaces the existing chat-code export
(pasteable in-game or into gw2skills.net). Both are non-destructive and start
AxiForge headless if closed (parse needs the catalog; link gen runs in-app).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — System prompt guidance (Part C, gw2skills/export lines only)

**Repo:** /var/home/mstephens/Documents/GitHub/axivale

### 5a. Write the failing assertions

- [ ] In `src/main/systemPrompt.test.ts`, add a test at the end of the `describe('system prompt', ...)` block:

```ts
  it('offers both gw2skills parse and import, and chat-link sharing', () => {
    // A pasted gw2skills link: offer parse (preview) AND import (rebuild), not one silently.
    expect(AXIVALE_SYSTEM_PROMPT).toContain('gw2skills_parse')
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_import_gw2skills')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/offer both/i)
    // Sharing a build via the in-game chat code.
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_build_chat_link')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/chat code/i)
  })
```

- [ ] Run, expecting failure (prompt does not mention these tools yet):

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2
```

Expected: the new test fails (`toContain('gw2skills_parse')` etc.). Existing prompt tests still pass.

### 5b. Implement the prompt addition

- [ ] In `src/main/agent.ts`, add a new bullet to `AXIVALE_SYSTEM_PROMPT`. Insert it directly after the AxiForge-store bullet that ends with `AxiForge deletes and publishes prompt the user to confirm via dialog; call\n  the tool and let the confirmation flow happen.` (right before the `- NEVER design or edit a build from memory:` bullet):

```ts
- A pasted gw2skills.net link: offer both — gw2skills_parse to decode and
  preview/critique it WITHOUT saving, and axiforge_import_gw2skills to rebuild
  it as a saved AxiForge build (which starts AxiForge automatically). Don't
  silently do one when the user wanted the other; ask if it's ambiguous.
- Sharing a build: axiforge_build_chat_link returns the in-game chat code for a
  build — the user can paste it in Guild Wars 2 to load it, or into
  gw2skills.net to view it.
```

- [ ] Run, expecting pass:

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/systemPrompt.test.ts --maxWorkers=2
```

Expected: all system-prompt tests pass.

### 5c. Commit

- [ ] Commit:

```
cd /var/home/mstephens/Documents/GitHub/axivale && git add -A && git commit -m "$(cat <<'EOF'
feat(prompt): guide gw2skills parse-vs-import and chat-link sharing

Offer both gw2skills_parse (preview, no save) and axiforge_import_gw2skills
(rebuild) for a pasted link; surface axiforge_build_chat_link for sharing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Final verification

**Repos:** both.

- [ ] AxiForge full unit suite (Jest), expecting green:

```
cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit
```

Expected: all unit tests pass, including `gw2skillsImport.test.js` and `localApi.test.js`.

- [ ] AxiVale full Vitest suite, expecting green:

```
cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run --maxWorkers=2
```

Expected: all tests pass, including `axiforgeClient.test.ts`, `tools/axiforge.test.ts`, `tools/inventory.test.ts`, `systemPrompt.test.ts`.

- [ ] AxiVale typecheck, expecting no errors:

```
cd /var/home/mstephens/Documents/GitHub/axivale && npm run typecheck
```

- [ ] AxiVale build, expecting success:

```
cd /var/home/mstephens/Documents/GitHub/axivale && npm run build
```

- [ ] If everything is green, the feature is complete. (Optional: open a PR per the repo's normal flow — the user merges.)

---

## Notes / assumptions

- **No existing fetch/db stub to mirror in AxiForge.** The current `gw2skillsImport.test.js` only tests pure helpers; `importGw2SkillsBuild` was never covered (it does live HTTPS). Task 1's `parseGw2Skills` test therefore introduces its own `jest.doMock` of `https`, `buildChatLink.js`, and `gw2Data` — this is new infrastructure, not a copy of an existing pattern. If a worker finds the mocked `https.request` shape drifts from what `httpsGet` expects (it reads `res.statusCode`, `res.headers.location`, and `data`/`end` events), adjust the mock to satisfy `httpsGet` (lines 10–43 of gw2skillsImport.js) — the assertions on the returned build are what matter.
- **"Does not save" is structural.** `gw2skillsImport.js` imports no store, so `parseGw2Skills` cannot write one; the test documents this by asserting the returned object shape rather than spying on a store. The save remains exclusively in the IPC handler / local-API op layer.
- The `ForgeBuild` return type on `parseGw2Skills` (client) is the same loose pass-through type used by `importGw2skills`; the parsed object is a build shape, so this is consistent with the codebase's existing typing choices.
