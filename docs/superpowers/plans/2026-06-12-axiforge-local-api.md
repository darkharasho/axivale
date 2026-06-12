# AxiForge Local API + Headless Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a localhost-only, bearer-token-authenticated HTTP API to AxiForge (with a discovery file and a `--headless` launch mode) so AxiVale can read, write, and publish builds and comps through AxiForge's existing store/handler logic.

**Working directory:** /var/home/mstephens/Documents/GitHub/axiforge

**Architecture:** A new electron-free module `src/main/localApi.js` runs a plain Node `http` server on `127.0.0.1` at a random port, routing requests to an injected `ops` object. `src/main/index.js` wires `ops` to the existing IPC handler functions via a tiny registry (`handle()` / `invokeLocal()`), so all validation, history capture, write queues, and shared-library sync are preserved unchanged. A discovery file `<userData>/data/local-api.json` (`{ port, token, exePath, version, pid }`) is written on startup and removed on clean shutdown; `--headless` starts services and the API without a `BrowserWindow`, and a single-instance lock makes a later windowed launch open the window inside the running instance.

**Tech Stack:** Electron 37 main process, CommonJS, Node `http`/`crypto`/`fs`, Jest 30 (existing runner — `testMatch: tests/**/*.test.js`, `testEnvironment: node`). Tests hit the real HTTP server on an ephemeral port with `BuildStore`/`CompStore`/`FolderStore` instances pointed at `fs.mkdtemp` temp dirs (same pattern as `tests/unit/buildStore.test.js`).

---

**Verified facts this plan is built on (from reading the source):**

- `src/main/index.js:57` — `const dataDir = path.join(app.getPath("userData"), "data");`. `package.json` has top-level `name: "axiforge-desktop"` and no top-level `productName`, so `app.getName()` is `axiforge-desktop` and userData on Linux is `~/.config/axiforge-desktop` (matching axiom's `configDir: 'axiforge-desktop'` in `../axiom/electron/apps.ts:39`). With `APP_PROFILE=<p>` set in dev, userData becomes `~/.config/axiforge-desktop-<p>` (`index.js:52-55`).
- All operations are inline `ipcMain.handle(channel, async (_e, ...) => {...})` closures registered inside `app.whenReady().then(...)` (`index.js:245-1853`). Relevant channels: `builds:list` (423), `builds:save` (424), `builds:delete` (474), `builds:publish-build` (843), `builds:generate-chat-link` (747), `builds:import-chat-link` (759), `builds:import-gw2skills` (764), `comps:list` (677), `comps:save` (678), `comps:delete` (703), `comps:publish-comp` (1033), `comps:generate-plaintext` (1449), `folders:list` (576).
- Catalog functions (from `src/main/gw2Data/index.js`, already imported at `index.js:36`): `getProfessionList("en")`, `getProfessionCatalog(professionId, "en", gameMode)`, `getUpgradeCatalog("en")`.
- Store APIs: `BuildStore` — `init()`, `listBuilds()`, `upsertBuild(input)`, `deleteBuild(id)` (`src/main/buildStore.js`); `CompStore` — `init()`, `listComps()`, `upsertComp(input)`, `deleteComp(id)` (`src/main/compStore.js`); `FolderStore` — `init()`, `listFolders()` (`src/main/folderStore.js`).
- There is **no** `requestSingleInstanceLock` call and **no** `axiom-version` file written anywhere in `src/main/` today (verified by grep). `window-all-closed` quits on non-darwin (`index.js:1855-1857`).
- Handlers use `_e.sender.send(channel, data)` for sync/publish progress events; `SharedLibrary` is constructed with an `emit` that already tolerates zero windows (`index.js:273-277`).
- Jest runs with `npx jest <file>`; Node is v24 so global `fetch` is available in tests.

---

## Task 1: CLI flags helper (`parseCliFlags`)

**Files:**
- Create: `src/main/cliFlags.js`
- Test: `tests/unit/cliFlags.test.js`

- [ ] Write the failing test `tests/unit/cliFlags.test.js`:

```js
"use strict";

const { parseCliFlags } = require("../../src/main/cliFlags");

describe("parseCliFlags", () => {
  test("detects --headless anywhere in argv", () => {
    expect(parseCliFlags(["electron", ".", "--headless"]).headless).toBe(true);
    expect(parseCliFlags(["/usr/bin/AxiForge", "--headless", "--foo"]).headless).toBe(true);
  });

  test("headless is false when flag absent", () => {
    expect(parseCliFlags(["electron", "."]).headless).toBe(false);
    expect(parseCliFlags([]).headless).toBe(false);
  });

  test("tolerates non-array input", () => {
    expect(parseCliFlags(undefined).headless).toBe(false);
    expect(parseCliFlags(null).headless).toBe(false);
  });
});
```

- [ ] Run it expecting failure: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit/cliFlags.test.js --maxWorkers=2` — expect `Cannot find module '../../src/main/cliFlags'`.
- [ ] Create `src/main/cliFlags.js`:

```js
"use strict";

// Parses CLI flags from an argv array. Used both for process.argv at startup
// and for the argv delivered by the "second-instance" event.
function parseCliFlags(argv) {
  const args = Array.isArray(argv) ? argv : [];
  return {
    headless: args.includes("--headless"),
  };
}

module.exports = { parseCliFlags };
```

- [ ] Run the test expecting pass: `npx jest tests/unit/cliFlags.test.js --maxWorkers=2` — expect `3 passed`.
- [ ] Commit: `git add src/main/cliFlags.js tests/unit/cliFlags.test.js && git commit -m "feat(local-api): add parseCliFlags helper for --headless detection"`

---

## Task 2: Discovery file module

**Files:**
- Create: `src/main/localApiDiscovery.js`
- Test: `tests/unit/localApiDiscovery.test.js`

- [ ] Write the failing test `tests/unit/localApiDiscovery.test.js`:

```js
"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const {
  discoveryFilePath,
  writeDiscoveryFile,
  removeDiscoveryFileSync,
} = require("../../src/main/localApiDiscovery");

describe("localApiDiscovery", () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-discovery-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("discoveryFilePath is <dataDir>/local-api.json", () => {
    expect(discoveryFilePath(dir)).toBe(path.join(dir, "local-api.json"));
  });

  test("writeDiscoveryFile writes the full record as JSON", async () => {
    const info = {
      port: 41234,
      token: "abc123",
      exePath: "/usr/bin/AxiForge",
      version: "0.6.30",
      pid: 9999,
    };
    await writeDiscoveryFile(dir, info);
    const raw = await fs.readFile(path.join(dir, "local-api.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(info);
  });

  test("writeDiscoveryFile creates the data dir and overwrites stale files", async () => {
    const nested = path.join(dir, "data");
    await writeDiscoveryFile(nested, { port: 1, token: "old", exePath: "x", version: "0", pid: 1 });
    await writeDiscoveryFile(nested, { port: 2, token: "new", exePath: "x", version: "0", pid: 2 });
    const parsed = JSON.parse(await fs.readFile(path.join(nested, "local-api.json"), "utf8"));
    expect(parsed.port).toBe(2);
    expect(parsed.token).toBe("new");
  });

  test("removeDiscoveryFileSync deletes the file and is a no-op when missing", async () => {
    await writeDiscoveryFile(dir, { port: 1, token: "t", exePath: "x", version: "0", pid: 1 });
    removeDiscoveryFileSync(dir);
    expect(fsSync.existsSync(path.join(dir, "local-api.json"))).toBe(false);
    expect(() => removeDiscoveryFileSync(dir)).not.toThrow();
  });
});
```

- [ ] Run it expecting failure: `npx jest tests/unit/localApiDiscovery.test.js --maxWorkers=2` — expect `Cannot find module '../../src/main/localApiDiscovery'`.
- [ ] Create `src/main/localApiDiscovery.js`:

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Discovery file for the local API. AxiVale (and other Axi apps) read this to
// find the port and per-launch bearer token. It lives next to builds.json, so
// it is exactly as private as the user's build data.
function discoveryFilePath(dataDir) {
  return path.join(dataDir, "local-api.json");
}

// Atomic write (tmp + rename), same pattern as BuildStore#writeJson, so a
// reader never sees a partially-written file. Mode 0o600 keeps the token
// owner-readable only.
async function writeDiscoveryFile(dataDir, info) {
  await fs.promises.mkdir(dataDir, { recursive: true });
  const target = discoveryFilePath(dataDir);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(info, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.promises.rename(tmp, target);
}

// Synchronous removal — called from app "will-quit", where async work is not
// guaranteed to complete before the process exits.
function removeDiscoveryFileSync(dataDir) {
  try {
    fs.unlinkSync(discoveryFilePath(dataDir));
  } catch {
    // Already gone (crashed previous run, first launch) — nothing to do.
  }
}

module.exports = { discoveryFilePath, writeDiscoveryFile, removeDiscoveryFileSync };
```

- [ ] Run the test expecting pass: `npx jest tests/unit/localApiDiscovery.test.js --maxWorkers=2` — expect `4 passed`.
- [ ] Commit: `git add src/main/localApiDiscovery.js tests/unit/localApiDiscovery.test.js && git commit -m "feat(local-api): discovery file writer/remover for local-api.json"`

---

## Task 3: Local API server core — auth, routing, /health

**Files:**
- Create: `src/main/localApi.js`
- Test: `tests/unit/localApi.test.js` (new; grows in Tasks 4-7)

- [ ] Write the failing test `tests/unit/localApi.test.js`:

```js
"use strict";

const { createLocalApi, generateToken } = require("../../src/main/localApi");

// Minimal ops stub — individual endpoint groups get real stores in later tests.
function stubOps(overrides = {}) {
  return {
    listBuilds: async () => [],
    saveBuild: async (b) => b,
    deleteBuild: async () => true,
    publishBuild: async () => ({}),
    generateChatLink: async () => "",
    listComps: async () => [],
    saveComp: async (c) => c,
    deleteComp: async () => undefined,
    publishComp: async () => ({}),
    compPlaintext: async () => "",
    importChatLink: async () => ({}),
    importGw2Skills: async () => ({}),
    listProfessions: async () => [],
    getProfessionCatalog: async () => ({}),
    getUpgradeCatalog: async () => ({}),
    listFolders: async () => [],
    ...overrides,
  };
}

async function startApi(opsOverrides = {}) {
  const token = generateToken();
  const api = createLocalApi({ token, version: "0.0.0-test", ops: stubOps(opsOverrides) });
  const { port } = await api.start();
  return { api, token, port };
}

function req(port, token, method, path, body) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("local API core", () => {
  let api, token, port;

  beforeEach(async () => {
    ({ api, token, port } = await startApi());
  });

  afterEach(async () => {
    await api.stop();
  });

  test("generateToken returns a 64-char hex string, unique per call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  test("listens on an ephemeral 127.0.0.1 port", () => {
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
  });

  test("rejects requests without a token with 401", async () => {
    const res = await req(port, null, "GET", "/health");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  test("rejects requests with a wrong token with 401", async () => {
    const res = await req(port, "not-the-token", "GET", "/health");
    expect(res.status).toBe(401);
  });

  test("GET /health returns ok + version", async () => {
    const res = await req(port, token, "GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "0.0.0-test" });
  });

  test("unknown route returns 404", async () => {
    const res = await req(port, token, "GET", "/nope");
    expect(res.status).toBe(404);
  });

  test("known path with wrong method returns 404", async () => {
    const res = await req(port, token, "DELETE", "/health");
    expect(res.status).toBe(404);
  });

  test("malformed JSON body returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/builds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  test("ops errors surface as 500 with the message", async () => {
    const { api: api2, token: t2, port: p2 } = await startApi({
      listBuilds: async () => { throw new Error("disk on fire"); },
    });
    const res = await req(p2, t2, "GET", "/builds");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("disk on fire");
    await api2.stop();
  });

  test("stop() shuts the server down", async () => {
    await api.stop();
    await expect(req(port, token, "GET", "/health")).rejects.toThrow();
    // Re-create for afterEach's stop()
    ({ api, token, port } = await startApi());
  });
});
```

- [ ] Run it expecting failure: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect `Cannot find module '../../src/main/localApi'`.
- [ ] Create `src/main/localApi.js`:

```js
"use strict";

// Local HTTP API for AxiVale (and other local Axi apps).
//
// - Binds to 127.0.0.1 only, on a random free port.
// - Every request requires "Authorization: Bearer <token>"; the token is
//   random per launch and published via the discovery file (localApiDiscovery).
// - Contains NO electron imports: all behavior is injected through `ops`,
//   which index.js wires to the existing IPC handler logic so validation,
//   history, write queues, and shared-library sync are preserved.

const http = require("node:http");
const crypto = require("node:crypto");

const MAX_BODY_BYTES = 5 * 1024 * 1024; // builds carry base64 images; 5MB matches real payloads

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Pattern segments starting with ":" capture into params. Routes are matched
// in declaration order; segment counts must match exactly.
function matchRoute(routes, method, pathname) {
  const segs = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const patSegs = route.pattern.split("/").filter(Boolean);
    if (patSegs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(":")) {
        params[patSegs[i].slice(1)] = decodeURIComponent(segs[i]);
      } else if (patSegs[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

function buildRoutes({ version, ops }) {
  return [
    { method: "GET", pattern: "/health", handler: async () => ({ ok: true, version }) },
  ];
}

function createLocalApi({ token, version, ops }) {
  if (!token) throw new Error("createLocalApi requires a token");
  if (!ops) throw new Error("createLocalApi requires an ops object");

  const routes = buildRoutes({ version, ops });

  const server = http.createServer(async (req, res) => {
    try {
      if ((req.headers["authorization"] || "") !== `Bearer ${token}`) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const match = matchRoute(routes, req.method, url.pathname);
      if (!match) {
        return sendJson(res, 404, { error: `No route: ${req.method} ${url.pathname}` });
      }
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJsonBody(req) : null;
      const result = await match.handler({ params: match.params, query: url.searchParams, body });
      sendJson(res, 200, result === undefined ? { ok: true } : result);
    } catch (err) {
      sendJson(res, err?.statusCode || 500, { error: err?.message || "Internal error" });
    }
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port }));
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get port() {
      return server.address()?.port ?? null;
    },
  };
}

module.exports = { createLocalApi, generateToken };
```

- [ ] Run the test expecting partial pass: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect the two `/builds` tests ("malformed JSON body returns 400" and "ops errors surface as 500") to FAIL with 404s (the `/builds` routes don't exist yet) and all other tests to pass.
- [ ] Temporarily confirm scope, then add the `/builds` collection route stubs needed by the core tests by replacing the `buildRoutes` body — this is also the start of Task 4's surface:

```js
function buildRoutes({ version, ops }) {
  return [
    { method: "GET", pattern: "/health", handler: async () => ({ ok: true, version }) },

    // ── Builds ───────────────────────────────────────────────────────────
    { method: "GET", pattern: "/builds", handler: async () => ops.listBuilds() },
    {
      method: "POST", pattern: "/builds",
      handler: async ({ body }) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw httpError(400, "Request body must be a build object");
        }
        return ops.saveBuild(body);
      },
    },
  ];
}
```

- [ ] Run the test expecting pass: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect `10 passed`.
- [ ] Commit: `git add src/main/localApi.js tests/unit/localApi.test.js && git commit -m "feat(local-api): http server core with bearer auth, routing, and /health"`

---

## Task 4: Builds endpoints

**Files:**
- Modify: `src/main/localApi.js` (extend `buildRoutes`, currently the function added in Task 3)
- Test: `tests/unit/localApi.test.js` (append) — uses the real `BuildStore` in a temp dir

- [ ] Append the failing tests to `tests/unit/localApi.test.js` (after the existing `describe` block; also add the requires at the top of the file):

```js
// Add to the top of the file with the other requires:
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");
```

```js
describe("local API — builds endpoints", () => {
  let api, token, port, dir, store;
  const published = [];
  const chatLinked = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-api-builds-"));
    store = new BuildStore(dir);
    await store.init();
    published.length = 0;
    chatLinked.length = 0;
    ({ api, token, port } = await startApi({
      listBuilds: () => store.listBuilds(),
      saveBuild: (b) => store.upsertBuild(b),
      deleteBuild: (id) => store.deleteBuild(id),
      publishBuild: async (id) => {
        published.push(id);
        return { pagesUrl: `https://example.test/?b=${id}`, slug: "test", fileId: "f1", changed: true };
      },
      generateChatLink: async (build) => {
        chatLinked.push(build.id);
        return "[&DQg1KTIlIjbBEgAAgQAAAEABAAC1EgAAtRIAAAAAAAAAAAAAAAAAAAAAAAA=]";
      },
    }));
  });

  afterEach(async () => {
    await api.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("GET /builds returns an empty list initially", async () => {
    const res = await req(port, token, "GET", "/builds");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST /builds creates a build through BuildStore normalization", async () => {
    const res = await req(port, token, "POST", "/builds", {
      title: "API Test Build",
      profession: "Warrior",
      tags: ["wvw"],
    });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.title).toBe("API Test Build");
    expect(saved.gameMode).toBe("pve"); // normalizeBuild default
    const onDisk = await store.listBuilds();
    expect(onDisk).toHaveLength(1);
  });

  test("POST /builds with an existing id updates the build", async () => {
    const created = await store.upsertBuild({ title: "Before", profession: "Ranger" });
    const res = await req(port, token, "POST", "/builds", { ...created, title: "After" });
    const updated = await res.json();
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("After");
    expect(await store.listBuilds()).toHaveLength(1);
  });

  test("GET /builds/:id returns the build, 404 when missing", async () => {
    const created = await store.upsertBuild({ title: "Findable", profession: "Thief" });
    const found = await req(port, token, "GET", `/builds/${created.id}`);
    expect(found.status).toBe(200);
    expect((await found.json()).title).toBe("Findable");

    const missing = await req(port, token, "GET", "/builds/does-not-exist");
    expect(missing.status).toBe(404);
  });

  test("DELETE /builds/:id removes the build", async () => {
    const created = await store.upsertBuild({ title: "Doomed", profession: "Mesmer" });
    const res = await req(port, token, "DELETE", `/builds/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await store.listBuilds()).toHaveLength(0);
  });

  test("POST /builds/:id/publish delegates to ops.publishBuild", async () => {
    const created = await store.upsertBuild({ title: "Pub", profession: "Guardian" });
    const res = await req(port, token, "POST", `/builds/${created.id}/publish`);
    expect(res.status).toBe(200);
    expect((await res.json()).pagesUrl).toContain(created.id);
    expect(published).toEqual([created.id]);
  });

  test("POST /builds/:id/chat-link looks up the build and returns { chatLink }", async () => {
    const created = await store.upsertBuild({ title: "Linkable", profession: "Engineer" });
    const res = await req(port, token, "POST", `/builds/${created.id}/chat-link`);
    expect(res.status).toBe(200);
    expect((await res.json()).chatLink).toMatch(/^\[&/);
    expect(chatLinked).toEqual([created.id]);
  });

  test("POST /builds/:id/chat-link returns 404 for an unknown build", async () => {
    const res = await req(port, token, "POST", "/builds/nope/chat-link");
    expect(res.status).toBe(404);
  });
});
```

- [ ] Run expecting failure: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect the `GET /builds/:id`, `DELETE`, `publish`, and `chat-link` tests to fail with 404 responses.
- [ ] Implement: in `src/main/localApi.js`, append these routes inside the `buildRoutes` return array, after the existing `POST /builds` entry:

```js
    {
      method: "GET", pattern: "/builds/:id",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        const build = builds.find((b) => b.id === params.id);
        if (!build) throw httpError(404, `Build not found: ${params.id}`);
        return build;
      },
    },
    {
      method: "DELETE", pattern: "/builds/:id",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        if (!builds.some((b) => b.id === params.id)) {
          throw httpError(404, `Build not found: ${params.id}`);
        }
        await ops.deleteBuild(params.id);
        return { ok: true };
      },
    },
    {
      method: "POST", pattern: "/builds/:id/publish",
      handler: async ({ params }) => ops.publishBuild(params.id),
    },
    {
      method: "POST", pattern: "/builds/:id/chat-link",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        const build = builds.find((b) => b.id === params.id);
        if (!build) throw httpError(404, `Build not found: ${params.id}`);
        return { chatLink: await ops.generateChatLink(build) };
      },
    },
```

- [ ] Run expecting pass: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect `18 passed`.
- [ ] Commit: `git add src/main/localApi.js tests/unit/localApi.test.js && git commit -m "feat(local-api): builds CRUD, publish, and chat-link endpoints"`

---

## Task 5: Comps endpoints

**Files:**
- Modify: `src/main/localApi.js` (extend `buildRoutes`)
- Test: `tests/unit/localApi.test.js` (append) — uses the real `CompStore` in a temp dir

- [ ] Append the failing tests to `tests/unit/localApi.test.js`:

```js
describe("local API — comps endpoints", () => {
  let api, token, port, dir, compStore;
  const publishedComps = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-api-comps-"));
    compStore = new CompStore(dir);
    await compStore.init();
    publishedComps.length = 0;
    ({ api, token, port } = await startApi({
      listComps: () => compStore.listComps(),
      saveComp: (c) => compStore.upsertComp(c),
      deleteComp: (id) => compStore.deleteComp(id),
      publishComp: async (id, boonCoverageHtml) => {
        publishedComps.push({ id, boonCoverageHtml });
        return { pagesUrl: `https://example.test/?c=${id}`, slug: "comp", fileId: "c1", changed: true };
      },
      compPlaintext: async (id) => {
        const comps = await compStore.listComps();
        const comp = comps.find((c) => c.id === id);
        if (!comp) throw new Error("Comp not found");
        return `**${comp.name}**\n\n**Comp**\n(empty)\n\n**Builds**\n(none)`;
      },
    }));
  });

  afterEach(async () => {
    await api.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("GET /comps returns an empty list initially", async () => {
    const res = await req(port, token, "GET", "/comps");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST /comps creates a comp through CompStore normalization", async () => {
    const res = await req(port, token, "POST", "/comps", { name: "Zerg Comp", gameMode: "wvw" });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.name).toBe("Zerg Comp");
    expect(saved.partyLines).toHaveLength(1); // CompStore default party line
    expect(await compStore.listComps()).toHaveLength(1);
  });

  test("GET /comps/:id returns the comp, 404 when missing", async () => {
    const created = await compStore.upsertComp({ name: "Findable Comp" });
    const found = await req(port, token, "GET", `/comps/${created.id}`);
    expect(found.status).toBe(200);
    expect((await found.json()).name).toBe("Findable Comp");

    const missing = await req(port, token, "GET", "/comps/does-not-exist");
    expect(missing.status).toBe(404);
  });

  test("DELETE /comps/:id removes the comp", async () => {
    const created = await compStore.upsertComp({ name: "Doomed Comp" });
    const res = await req(port, token, "DELETE", `/comps/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await compStore.listComps()).toHaveLength(0);
  });

  test("POST /comps/:id/publish forwards optional boonCoverageHtml", async () => {
    const created = await compStore.upsertComp({ name: "Pub Comp" });
    const res = await req(port, token, "POST", `/comps/${created.id}/publish`, {
      boonCoverageHtml: "<table></table>",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).pagesUrl).toContain(created.id);
    expect(publishedComps).toEqual([{ id: created.id, boonCoverageHtml: "<table></table>" }]);
  });

  test("POST /comps/:id/publish works without a body", async () => {
    const created = await compStore.upsertComp({ name: "Pub Comp 2" });
    const res = await req(port, token, "POST", `/comps/${created.id}/publish`);
    expect(res.status).toBe(200);
    expect(publishedComps[0].boonCoverageHtml).toBeUndefined();
  });

  test("GET /comps/:id/plaintext returns { text }", async () => {
    const created = await compStore.upsertComp({ name: "Plain Comp" });
    const res = await req(port, token, "GET", `/comps/${created.id}/plaintext`);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain("**Plain Comp**");
  });
});
```

- [ ] Run expecting failure: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect all 7 new comps tests to fail with 404 responses.
- [ ] Implement: append these routes inside `buildRoutes` in `src/main/localApi.js`:

```js
    // ── Comps ────────────────────────────────────────────────────────────
    { method: "GET", pattern: "/comps", handler: async () => ops.listComps() },
    {
      method: "POST", pattern: "/comps",
      handler: async ({ body }) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw httpError(400, "Request body must be a comp object");
        }
        return ops.saveComp(body);
      },
    },
    {
      method: "GET", pattern: "/comps/:id",
      handler: async ({ params }) => {
        const comps = await ops.listComps();
        const comp = comps.find((c) => c.id === params.id);
        if (!comp) throw httpError(404, `Comp not found: ${params.id}`);
        return comp;
      },
    },
    {
      method: "DELETE", pattern: "/comps/:id",
      handler: async ({ params }) => {
        const comps = await ops.listComps();
        if (!comps.some((c) => c.id === params.id)) {
          throw httpError(404, `Comp not found: ${params.id}`);
        }
        await ops.deleteComp(params.id);
        return { ok: true };
      },
    },
    {
      method: "POST", pattern: "/comps/:id/publish",
      handler: async ({ params, body }) => ops.publishComp(params.id, body?.boonCoverageHtml),
    },
    {
      method: "GET", pattern: "/comps/:id/plaintext",
      handler: async ({ params }) => ({ text: await ops.compPlaintext(params.id) }),
    },
```

- [ ] Run expecting pass: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect `25 passed`.
- [ ] Commit: `git add src/main/localApi.js tests/unit/localApi.test.js && git commit -m "feat(local-api): comps CRUD, publish, and plaintext endpoints"`

---

## Task 6: Import endpoints (chat-link, gw2skills)

**Files:**
- Modify: `src/main/localApi.js` (extend `buildRoutes`)
- Test: `tests/unit/localApi.test.js` (append) — import logic is stubbed; the real decoding lives in `buildChatLink.js` / `gw2skillsImport.js` and is exercised by their own existing tests

- [ ] Append the failing tests to `tests/unit/localApi.test.js`:

```js
describe("local API — import endpoints", () => {
  let api, token, port;
  const importedChatLinks = [];
  const importedGw2Skills = [];

  beforeEach(async () => {
    importedChatLinks.length = 0;
    importedGw2Skills.length = 0;
    ({ api, token, port } = await startApi({
      importChatLink: async (link, name, folderId, gameMode) => {
        importedChatLinks.push({ link, name, folderId, gameMode });
        return { id: "imported-1", title: name || "Imported Build", gameMode: gameMode || "pve" };
      },
      importGw2Skills: async (url, name, folderId, gameMode) => {
        importedGw2Skills.push({ url, name, folderId, gameMode });
        return { id: "imported-2", title: name || "Imported Build", gameMode: gameMode || "pve" };
      },
    }));
  });

  afterEach(async () => {
    await api.stop();
  });

  test("POST /import/chat-link forwards link, name, folderId, gameMode", async () => {
    const res = await req(port, token, "POST", "/import/chat-link", {
      link: "[&DQg1KTIlIjY=]",
      name: "Imported Hammer",
      folderId: "folder-1",
      gameMode: "wvw",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("imported-1");
    expect(importedChatLinks).toEqual([
      { link: "[&DQg1KTIlIjY=]", name: "Imported Hammer", folderId: "folder-1", gameMode: "wvw" },
    ]);
  });

  test("POST /import/chat-link requires a link", async () => {
    const res = await req(port, token, "POST", "/import/chat-link", { name: "No Link" });
    expect(res.status).toBe(400);
    expect(importedChatLinks).toHaveLength(0);
  });

  test("POST /import/gw2skills forwards url, name, folderId, gameMode", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills", {
      url: "http://gw2skills.net/editor/?ABC",
      name: "Imported gw2skills",
      folderId: null,
      gameMode: "pve",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("imported-2");
    expect(importedGw2Skills).toEqual([
      { url: "http://gw2skills.net/editor/?ABC", name: "Imported gw2skills", folderId: null, gameMode: "pve" },
    ]);
  });

  test("POST /import/gw2skills requires a url", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills", {});
    expect(res.status).toBe(400);
    expect(importedGw2Skills).toHaveLength(0);
  });
});
```

- [ ] Run expecting failure: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect the 4 new tests to fail with 404 responses.
- [ ] Implement: append these routes inside `buildRoutes` in `src/main/localApi.js`:

```js
    // ── Imports ──────────────────────────────────────────────────────────
    {
      method: "POST", pattern: "/import/chat-link",
      handler: async ({ body }) => {
        if (!body?.link || typeof body.link !== "string") {
          throw httpError(400, "Body must include a chat link string: { link }");
        }
        return ops.importChatLink(body.link, body.name ?? null, body.folderId ?? null, body.gameMode ?? null);
      },
    },
    {
      method: "POST", pattern: "/import/gw2skills",
      handler: async ({ body }) => {
        if (!body?.url || typeof body.url !== "string") {
          throw httpError(400, "Body must include a gw2skills editor URL: { url }");
        }
        return ops.importGw2Skills(body.url, body.name ?? null, body.folderId ?? null, body.gameMode ?? null);
      },
    },
```

- [ ] Run expecting pass: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect `29 passed`.
- [ ] Commit: `git add src/main/localApi.js tests/unit/localApi.test.js && git commit -m "feat(local-api): import endpoints for chat links and gw2skills URLs"`

---

## Task 7: Catalog and folders endpoints

**Files:**
- Modify: `src/main/localApi.js` (extend `buildRoutes`)
- Test: `tests/unit/localApi.test.js` (append) — catalog ops stubbed (real catalog functions hit the GW2 API; their behavior is covered by `tests/unit/gw2Data.test.js`), folders use the real `FolderStore`

- [ ] Append the failing tests to `tests/unit/localApi.test.js`:

```js
describe("local API — catalog and folders endpoints", () => {
  let api, token, port, dir, folderStore;
  const catalogCalls = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-api-catalog-"));
    folderStore = new FolderStore(dir);
    await folderStore.init();
    catalogCalls.length = 0;
    ({ api, token, port } = await startApi({
      listProfessions: async () => [{ id: "Guardian", name: "Guardian" }],
      getProfessionCatalog: async (id, gameMode) => {
        catalogCalls.push({ id, gameMode });
        return { profession: { id, name: id }, specializations: [], skills: [] };
      },
      getUpgradeCatalog: async () => ({ runes: [], sigils: [], relics: [] }),
      listFolders: () => folderStore.listFolders(),
    }));
  });

  afterEach(async () => {
    await api.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("GET /catalog/professions returns the profession list", async () => {
    const res = await req(port, token, "GET", "/catalog/professions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "Guardian", name: "Guardian" }]);
  });

  test("GET /catalog/professions/:id passes id and gameMode query", async () => {
    const res = await req(port, token, "GET", "/catalog/professions/Necromancer?gameMode=wvw");
    expect(res.status).toBe(200);
    expect((await res.json()).profession.id).toBe("Necromancer");
    expect(catalogCalls).toEqual([{ id: "Necromancer", gameMode: "wvw" }]);
  });

  test("GET /catalog/professions/:id omits gameMode when not given", async () => {
    await req(port, token, "GET", "/catalog/professions/Warrior");
    expect(catalogCalls).toEqual([{ id: "Warrior", gameMode: undefined }]);
  });

  test("GET /catalog/upgrades returns the upgrade catalog", async () => {
    const res = await req(port, token, "GET", "/catalog/upgrades");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runes: [], sigils: [], relics: [] });
  });

  test("GET /folders returns folders from the store", async () => {
    await folderStore.upsertFolder({ name: "WvW Builds" });
    const res = await req(port, token, "GET", "/folders");
    expect(res.status).toBe(200);
    const folders = await res.json();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("WvW Builds");
  });
});
```

- [ ] Run expecting failure: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect the 5 new tests to fail with 404 responses.
- [ ] Implement: append these routes inside `buildRoutes` in `src/main/localApi.js`:

```js
    // ── Catalog ──────────────────────────────────────────────────────────
    { method: "GET", pattern: "/catalog/professions", handler: async () => ops.listProfessions() },
    {
      method: "GET", pattern: "/catalog/professions/:id",
      handler: async ({ params, query }) =>
        ops.getProfessionCatalog(params.id, query.get("gameMode") || undefined),
    },
    { method: "GET", pattern: "/catalog/upgrades", handler: async () => ops.getUpgradeCatalog() },

    // ── Folders ──────────────────────────────────────────────────────────
    { method: "GET", pattern: "/folders", handler: async () => ops.listFolders() },
```

- [ ] Run expecting pass: `npx jest tests/unit/localApi.test.js --maxWorkers=2` — expect `34 passed`.
- [ ] Run the full unit suite to confirm no regressions: `npx jest tests/unit --maxWorkers=2` — expect all suites green.
- [ ] Commit: `git add src/main/localApi.js tests/unit/localApi.test.js && git commit -m "feat(local-api): catalog and folders endpoints"`

---

## Task 8: Wire the API into the app — IPC registry, startup, discovery file, shutdown, axiom-version

**Files:**
- Modify: `src/main/index.js` (requires block lines 1-42; add registry helpers before `app.whenReady` at line 245; mechanical `ipcMain.handle(` → `handle(` replacement at lines 338-1852; API startup at the end of the `whenReady` callback, after `shared-library:force-push` at line 1847; shutdown hook after `whenReady` block)
- Test: existing suites (`npx jest tests/unit --maxWorkers=2`) + manual smoke verification (electron main wiring is not jest-testable; all new logic-bearing code was unit-tested in Tasks 1-7)

- [ ] Add the new requires in `src/main/index.js` directly after line 42 (`const { registerAxicodeFileHandlers } = require("./axicodeFile");`):

```js
const { createLocalApi, generateToken } = require("./localApi");
const { writeDiscoveryFile, removeDiscoveryFileSync } = require("./localApiDiscovery");
const { parseCliFlags } = require("./cliFlags");
```

- [ ] Add the registry + broadcast helpers immediately before `app.whenReady().then(async () => {` (line 245):

```js
// Send an event to every open window. No-op when headless (zero windows).
function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, data);
  }
}

// IPC registry: handle() registers with ipcMain AND records the handler so the
// local API can call the exact same function via invokeLocal(). This keeps the
// HTTP endpoints thin wrappers over the existing handlers — history capture,
// shared-library sync, ownership guards, and publish flows are all reused.
const ipcRegistry = new Map();
function handle(channel, fn) {
  ipcRegistry.set(channel, fn);
  ipcMain.handle(channel, fn);
}
function invokeLocal(channel, ...args) {
  const fn = ipcRegistry.get(channel);
  if (!fn) return Promise.reject(new Error(`No handler registered for ${channel}`));
  // Handlers expect an event whose sender.send() emits progress/sync events;
  // for API-originated calls, fan those out to any open windows.
  const fakeEvent = { sender: { send: broadcast } };
  return Promise.resolve(fn(fakeEvent, ...args));
}
```

- [ ] Mechanically convert every registration to the registry (the only occurrences of `ipcMain.handle(` in the repo's main process are real registrations in this file):

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
grep -c "ipcMain\.handle(" src/main/index.js   # note the count (expected: 76)
sed -i 's/ipcMain\.handle(/handle(/g' src/main/index.js
grep -c "ipcMain\.handle(" src/main/index.js   # expect 0
grep -c "  handle(" src/main/index.js           # expect the same count as before
```

Note: `ipcMain` stays imported on line 9 — it is still used inside `handle()` (and by `registerAxicodeFileHandlers` internally).

- [ ] Add API startup at the **end** of the `whenReady` callback (after the `handle("shared-library:force-push", ...)` block at line 1847-1852, so every handler is registered before the server accepts requests):

```js
  // ─── Local API (consumed by AxiVale and other local Axi apps) ─────────────
  const apiToken = generateToken();
  localApi = createLocalApi({
    token: apiToken,
    version: app.getVersion(),
    ops: {
      listBuilds: () => invokeLocal("builds:list"),
      saveBuild: (build) => invokeLocal("builds:save", build),
      deleteBuild: (id) => invokeLocal("builds:delete", id),
      publishBuild: (id) => invokeLocal("builds:publish-build", id),
      generateChatLink: (build) => invokeLocal("builds:generate-chat-link", build),
      listComps: () => invokeLocal("comps:list"),
      saveComp: (comp) => invokeLocal("comps:save", comp),
      deleteComp: (id) => invokeLocal("comps:delete", id),
      publishComp: (id, boonCoverageHtml) => invokeLocal("comps:publish-comp", id, boonCoverageHtml),
      compPlaintext: (id) => invokeLocal("comps:generate-plaintext", id),
      importChatLink: (link, name, folderId, gameMode) =>
        invokeLocal("builds:import-chat-link", link, name, folderId, gameMode),
      importGw2Skills: (url, name, folderId, gameMode) =>
        invokeLocal("builds:import-gw2skills", url, name, folderId, gameMode),
      listProfessions: () => getProfessionList("en"),
      getProfessionCatalog: (id, gameMode) => getProfessionCatalog(id, "en", gameMode),
      getUpgradeCatalog: () => getUpgradeCatalog("en"),
      listFolders: () => folderStore.listFolders(),
    },
  });
  try {
    const { port } = await localApi.start();
    await writeDiscoveryFile(dataDir, {
      port,
      token: apiToken,
      exePath: app.getPath("exe"),
      version: app.getVersion(),
      pid: process.pid,
    });
    console.log(`[local-api] listening on 127.0.0.1:${port}`);
  } catch (err) {
    // The app must stay fully usable without the API (e.g. port exhaustion).
    console.error("[local-api] failed to start:", err?.message || err);
  }

  // axiom install-detection convention: write the current version to
  // <userData>/axiom-version so axiom (and AxiVale's launcher) can detect the
  // installed app on Linux. AxiForge did not previously write this file.
  try {
    require("node:fs").writeFileSync(
      path.join(app.getPath("userData"), "axiom-version"),
      app.getVersion(),
      "utf8",
    );
  } catch (err) {
    console.warn("[axiom-version] write failed:", err?.message || err);
  }
```

  And add the module-level holder next to the `broadcast` helper added earlier (so the shutdown hook below can reach it):

```js
let localApi = null;
```

  (Change the assignment in the startup code accordingly: `localApi = createLocalApi({...})` — shown above already without `const`.)

- [ ] Add the shutdown hook after the `whenReady` block, next to the existing `app.on("window-all-closed", ...)` at line 1855:

```js
app.on("will-quit", () => {
  // Invalidate discovery on clean shutdown so clients never talk to a dead
  // port. Stale files from crashes are handled by clients via /health checks
  // and are overwritten on the next startup.
  removeDiscoveryFileSync(dataDir);
  if (localApi) localApi.stop().catch(() => {});
});
```

- [ ] Run the full unit suite (index.js is excluded from coverage but other suites must stay green): `npx jest tests/unit --maxWorkers=2` — expect all suites passing.
- [ ] Manual smoke verification (uses an isolated `APP_PROFILE` so real user data is untouched; `npm run build:renderer` once beforehand if `dist/renderer` is missing):

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
APP_PROFILE=apitest npx electron . & APP_PID=$!
sleep 6
DISC=~/.config/axiforge-desktop-apitest/data/local-api.json
cat "$DISC"   # expect JSON with port, token (64 hex chars), exePath, version "0.6.30", pid
PORT=$(node -p "require('$DISC').port")
TOKEN=$(node -p "require('$DISC').token")
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT/health"                      # expect 401
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health"                     # expect {"ok":true,"version":"0.6.30"}
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/builds"                     # expect []
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Smoke Build","profession":"Warrior"}' "http://127.0.0.1:$PORT/builds"         # expect saved build JSON with id
cat ~/.config/axiforge-desktop-apitest/axiom-version                                           # expect 0.6.30
kill -TERM $APP_PID; sleep 3
test -f "$DISC" && echo "FAIL: discovery file still present" || echo "OK: discovery file removed"
```

- [ ] Commit: `git add src/main/index.js && git commit -m "feat(local-api): start API on launch, write discovery + axiom-version files, clean up on quit"`

---

## Task 9: Headless mode + single-instance lock

**Files:**
- Modify: `src/main/index.js` (flag parsing + lock near line 56 before `dataDir`; window-creation block at lines 299-320; `registerAxicodeFileHandlers(win)` call at line 1654; `window-all-closed`/`activate` handlers at lines 1855-1861)
- Test: `tests/unit/cliFlags.test.js` already covers flag parsing (Task 1); the electron wiring below is verified by the manual smoke steps at the end of this task

- [ ] Add flag parsing and the single-instance lock in `src/main/index.js`, directly after the `APP_PROFILE` block (after line 55, before `const dataDir = ...`):

```js
const cliFlags = parseCliFlags(process.argv);

// Single instance: a second launch hands its argv to the running instance and
// exits. A later *windowed* launch against a running headless instance opens
// the window in the existing process (see "second-instance" below).
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  if (parseCliFlags(argv).headless) return; // services already running — nothing to show
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
  } else {
    openMainWindow();
  }
});
```

- [ ] Add the module-level window holder + `openMainWindow` next to the `let localApi = null;` line added in Task 8:

```js
let mainWindow = null;
let axicodeHandlersRegistered = false;

// Creates (or focuses) the main window. Used by normal startup, the macOS
// "activate" handler, and "second-instance" when a windowed launch hits a
// running headless instance. Safe to call before whenReady resolves only via
// those electron events, which all fire after ready.
function openMainWindow(savedBounds) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = createWindow(savedBounds);
  initAutoUpdate(mainWindow);
  if (!axicodeHandlersRegistered) {
    registerAxicodeFileHandlers(mainWindow);
    axicodeHandlersRegistered = true;
  }
  return mainWindow;
}
```

- [ ] Inside the `whenReady` callback, guard against the losing-the-lock case and replace the direct window creation. At the very top of the callback (line 245, first statement) add:

```js
  if (!gotInstanceLock) return; // a second launch — the running instance handles it
```

  Then replace lines 313-320 (currently):

```js
  const win = createWindow(savedBounds);
  initAutoUpdate(win);

  // Update window icon when system theme changes (light ↔ dark)
  nativeTheme.on("updated", () => {
    const icon = nativeImage.createFromPath(getIconPath());
    win?.setIcon(icon);
  });
```

  with:

```js
  if (!cliFlags.headless) {
    openMainWindow(savedBounds);
  } else {
    console.log("[headless] started without a window — services and local API only");
  }

  // Update window icon when system theme changes (light ↔ dark)
  nativeTheme.on("updated", () => {
    const icon = nativeImage.createFromPath(getIconPath());
    mainWindow?.setIcon(icon);
  });
```

- [ ] Delete line 1654 (`registerAxicodeFileHandlers(win);` — now registered inside `openMainWindow`, including in headless instances once a window is first opened) and its comment line 1653 (`// .axicode file export/import`).
- [ ] Replace the `window-all-closed` / `activate` handlers (lines 1855-1861) with:

```js
app.on("window-all-closed", () => {
  // A headless-launched instance keeps services + the local API running when
  // the user closes a window that was opened into it later.
  if (cliFlags.headless) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
});
```

- [ ] Run the full unit suite: `npx jest tests/unit --maxWorkers=2` — expect all suites passing.
- [ ] Manual smoke verification:

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
# 1. Headless start: API up, no window appears
APP_PROFILE=apitest npx electron . --headless & HEADLESS_PID=$!
sleep 6
DISC=~/.config/axiforge-desktop-apitest/data/local-api.json
PORT=$(node -p "require('$DISC').port"); TOKEN=$(node -p "require('$DISC').token")
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health"   # expect {"ok":true,...}; confirm NO window opened

# 2. Second, windowed launch opens a window in the SAME instance
APP_PROFILE=apitest npx electron .   # this process exits immediately; a window appears, owned by $HEADLESS_PID
node -p "require('$DISC').pid"        # still the headless instance's pid — no new API/discovery file

# 3. Closing the window keeps the headless instance's API alive
#    (close the window via its close button, then:)
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health"   # still {"ok":true,...}

# 4. Clean shutdown removes discovery
kill -TERM $HEADLESS_PID; sleep 3
test -f "$DISC" && echo "FAIL: discovery file still present" || echo "OK"
```

- [ ] Commit: `git add src/main/index.js && git commit -m "feat(headless): --headless mode with single-instance lock and window adoption"`

---

## Task 10: Final verification

**Files:**
- Modify: none (verification only)

- [ ] Run the entire unit suite from a clean tree: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit --maxWorkers=2` — expect all suites green, including the four new/updated files (`cliFlags.test.js`, `localApiDiscovery.test.js`, `localApi.test.js`, plus all pre-existing suites).
- [ ] Run the integration suite to catch index.js regressions: `npx jest tests/integration --maxWorkers=2` — expect green.
- [ ] Confirm git log shows the conventional-commit series: `git log --oneline -8` — expect the 7 feature commits from Tasks 1-9.
- [ ] Confirm no stray artifacts: `git status` — expect a clean tree.
