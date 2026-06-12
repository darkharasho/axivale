# GW2 Officer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Electron chat app ("GW2 Officer") where a Claude agent manages GW2 guild builds/comps through a new local HTTP API inside the axitools Discord bot, and queries the guild roster/log via the GW2 API — styled as a dark-newsprint gazette.

**Architecture:** Two repos. Part A adds an aiohttp localhost API module inside `../axitools` (bearer-token auth, calls the existing `storage.py` layer). Part B builds the Electron app in this repo: main process hosts the Claude Agent SDK (`query()` + in-process MCP tools via `createSdkMcpServer`), secrets in `safeStorage`, React renderer renders the approved "Dark Newsprint Gazette" UI (spec: `docs/superpowers/specs/2026-06-11-gw2-officer-design.md`).

**Tech Stack:** Python 3.11+/aiohttp/pytest (Part A); Electron + electron-vite + React + TypeScript + zod + `@anthropic-ai/claude-agent-sdk` + Vitest (Part B).

**Conventions:**
- Part A tasks run in `/var/home/mstephens/Documents/GitHub/axitools` (its own git repo — commit there).
- Part B tasks run in `/var/home/mstephens/Documents/GitHub/gw2-officer`.
- Vitest must run with limited parallelism: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2` (user's global rule; the `npm test` script below encodes it).
- Python tests: `PYTHONPATH=. pytest tests -v` from the axitools root.

---

# Part A — Axitools local API

### Task 1: API module skeleton — auth + `GET /guilds`

**Files:**
- Create: `axitools/api/__init__.py`
- Create: `axitools/api/server.py`
- Test: `tests/test_api_server.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Add dependencies**

Append to `requirements.txt` (aiohttp is only transitive today; the test plugin is new):

```
aiohttp>=3.9.0
pytest-aiohttp>=1.0.5
```

Run: `pip install aiohttp pytest-aiohttp` (inside the repo's venv).

- [ ] **Step 2: Write the failing test**

Create `tests/test_api_server.py`:

```python
from pathlib import Path

import pytest

from axitools.api.server import build_app, resolve_api_token
from axitools.storage import StorageManager


class FakeGuild:
    def __init__(self, guild_id: int, name: str) -> None:
        self.id = guild_id
        self.name = name


class FakeBot:
    """Minimal stand-in for AxiToolsBot: just .storage and .guilds."""

    def __init__(self, root: Path) -> None:
        self.storage = StorageManager(root)
        self.guilds = [FakeGuild(123, "Vigil Keep")]


@pytest.fixture
def bot(tmp_path):
    return FakeBot(tmp_path)


@pytest.fixture
async def api_client(aiohttp_client, bot):
    app = build_app(bot, token="test-token")
    return await aiohttp_client(app)


def _auth():
    return {"Authorization": "Bearer test-token"}


async def test_rejects_missing_token(api_client):
    resp = await api_client.get("/guilds")
    assert resp.status == 401


async def test_rejects_wrong_token(api_client):
    resp = await api_client.get("/guilds", headers={"Authorization": "Bearer nope"})
    assert resp.status == 401


async def test_lists_guilds(api_client):
    resp = await api_client.get("/guilds", headers=_auth())
    assert resp.status == 200
    assert await resp.json() == [{"id": 123, "name": "Vigil Keep"}]


def test_resolve_api_token_generates_and_persists(tmp_path):
    first = resolve_api_token(tmp_path)
    second = resolve_api_token(tmp_path)
    assert first == second
    assert len(first) == 64  # token_hex(32)
    assert (tmp_path / "api_token").exists()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_api_server.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'axitools.api'`

- [ ] **Step 4: Implement the module**

Create `axitools/api/__init__.py` (empty file).

Create `axitools/api/server.py`:

```python
"""Localhost HTTP API for GW2 Officer (and other local clients).

Binds to 127.0.0.1 only. All requests require ``Authorization: Bearer <token>``.
The token comes from AXITOOLS_API_TOKEN, or is generated once and persisted
under the storage root as ``api_token`` (mode 0600).
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from aiohttp import web

LOGGER = logging.getLogger(__name__)

DEFAULT_PORT = 8642


def resolve_api_token(root: Path) -> str:
    env = os.getenv("AXITOOLS_API_TOKEN")
    if env:
        return env.strip()
    token_path = root / "api_token"
    if token_path.exists():
        return token_path.read_text().strip()
    token = secrets.token_hex(32)
    root.mkdir(parents=True, exist_ok=True)
    token_path.write_text(token)
    token_path.chmod(0o600)
    return token


@web.middleware
async def _auth_middleware(request: web.Request, handler):
    expected = f"Bearer {request.app['api_token']}"
    supplied = request.headers.get("Authorization", "")
    if not secrets.compare_digest(supplied.encode(), expected.encode()):
        return web.json_response({"error": "unauthorized"}, status=401)
    return await handler(request)


async def _handle_guilds(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    return web.json_response([{"id": g.id, "name": g.name} for g in bot.guilds])


def build_app(bot, token: str) -> web.Application:
    app = web.Application(middlewares=[_auth_middleware])
    app["bot"] = bot
    app["api_token"] = token
    app.router.add_get("/guilds", _handle_guilds)
    return app


async def start_api(bot, *, host: str = "127.0.0.1", port: int | None = None) -> web.AppRunner:
    """Start the API server inside the bot process. Returns the runner for cleanup."""
    if port is None:
        port = int(os.getenv("AXITOOLS_API_PORT", str(DEFAULT_PORT)))
    token = resolve_api_token(bot.storage.root)
    app = build_app(bot, token)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    LOGGER.info("AxiTools API listening on http://%s:%s", host, port)
    return runner
```

Note: `StorageManager` exposes its root path — check `axitools/storage.py` for the attribute name (`self.root`); if it differs, adapt `bot.storage.root` accordingly.

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_api_server.py -v`
Expected: 4 PASS

- [ ] **Step 6: Commit (in the axitools repo)**

```bash
git add axitools/api tests/test_api_server.py requirements.txt
git commit -m "feat: add localhost HTTP API skeleton with bearer auth"
```

---

### Task 2: Builds endpoints

**Files:**
- Modify: `axitools/api/server.py`
- Test: `tests/test_api_builds.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_api_builds.py`:

```python
from pathlib import Path

import pytest

from axitools.api.server import build_app
from axitools.storage import StorageManager

from tests.test_api_server import FakeBot, _auth  # reuse fixtures' helpers

GID = 123


@pytest.fixture
def bot(tmp_path):
    return FakeBot(tmp_path)


@pytest.fixture
async def api_client(aiohttp_client, bot):
    app = build_app(bot, token="test-token")
    return await aiohttp_client(app)


async def test_builds_crud(api_client, bot):
    # empty list
    resp = await api_client.get(f"/guilds/{GID}/builds", headers=_auth())
    assert resp.status == 200
    assert await resp.json() == []

    # create
    payload = {
        "name": "Quickness Firebrand",
        "profession": "Guardian",
        "specialization": "Firebrand",
        "chat_code": "[&DQEAAA==]",
        "url": "https://gw2skills.net/x",
        "description": "Stab + quickness support",
    }
    resp = await api_client.post(f"/guilds/{GID}/builds", json=payload, headers=_auth())
    assert resp.status == 201
    created = await resp.json()
    assert created["name"] == "Quickness Firebrand"
    build_id = created["build_id"]
    assert build_id

    # list shows it (and storage agrees)
    resp = await api_client.get(f"/guilds/{GID}/builds", headers=_auth())
    assert [b["build_id"] for b in await resp.json()] == [build_id]
    assert bot.storage.get_builds(GID)[0].name == "Quickness Firebrand"

    # update
    resp = await api_client.put(
        f"/guilds/{GID}/builds/{build_id}",
        json={"description": "Updated"},
        headers=_auth(),
    )
    assert resp.status == 200
    assert (await resp.json())["description"] == "Updated"
    assert bot.storage.get_builds(GID)[0].description == "Updated"

    # delete
    resp = await api_client.delete(f"/guilds/{GID}/builds/{build_id}", headers=_auth())
    assert resp.status == 204
    assert bot.storage.get_builds(GID) == []


async def test_build_not_found(api_client):
    resp = await api_client.put(
        f"/guilds/{GID}/builds/missing", json={"name": "x"}, headers=_auth()
    )
    assert resp.status == 404
    resp = await api_client.delete(f"/guilds/{GID}/builds/missing", headers=_auth())
    assert resp.status == 404


async def test_build_create_requires_fields(api_client):
    resp = await api_client.post(f"/guilds/{GID}/builds", json={}, headers=_auth())
    assert resp.status == 400
```

- [ ] **Step 2: Run to verify failure**

Run: `PYTHONPATH=. pytest tests/test_api_builds.py -v`
Expected: FAIL with 404s (routes not registered)

- [ ] **Step 3: Implement builds handlers**

Add to `axitools/api/server.py` (imports at top: `import secrets` already there; add `from dataclasses import asdict` and `from ..storage import BuildRecord, utcnow`). The API actor uses user id `0` for `created_by`/`updated_by`.

```python
API_ACTOR_ID = 0


def _build_to_json(record) -> dict:
    return asdict(record)


async def _handle_builds_list(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    return web.json_response([_build_to_json(b) for b in bot.storage.get_builds(gid)])


async def _handle_builds_create(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    body = await request.json()
    for field in ("name", "profession", "chat_code"):
        if not body.get(field):
            return web.json_response({"error": f"missing field: {field}"}, status=400)
    now = utcnow()
    record = BuildRecord(
        build_id=secrets.token_hex(8),
        name=body["name"],
        profession=body["profession"],
        specialization=body.get("specialization"),
        url=body.get("url"),
        chat_code=body["chat_code"],
        description=body.get("description"),
        created_by=API_ACTOR_ID,
        created_at=now,
        updated_by=API_ACTOR_ID,
        updated_at=now,
    )
    builds = bot.storage.get_builds(gid)
    builds.append(record)
    bot.storage.save_builds(gid, builds)
    return web.json_response(_build_to_json(record), status=201)


_BUILD_EDITABLE = ("name", "profession", "specialization", "url", "chat_code", "description")


async def _handle_builds_update(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    build_id = request.match_info["build_id"]
    body = await request.json()
    builds = bot.storage.get_builds(gid)
    for record in builds:
        if record.build_id == build_id:
            for field in _BUILD_EDITABLE:
                if field in body:
                    setattr(record, field, body[field])
            record.updated_by = API_ACTOR_ID
            record.updated_at = utcnow()
            bot.storage.save_builds(gid, builds)
            return web.json_response(_build_to_json(record))
    return web.json_response({"error": "build not found"}, status=404)


async def _handle_builds_delete(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    build_id = request.match_info["build_id"]
    builds = bot.storage.get_builds(gid)
    remaining = [b for b in builds if b.build_id != build_id]
    if len(remaining) == len(builds):
        return web.json_response({"error": "build not found"}, status=404)
    bot.storage.save_builds(gid, remaining)
    return web.Response(status=204)
```

Register in `build_app()`:

```python
    app.router.add_get("/guilds/{guild_id}/builds", _handle_builds_list)
    app.router.add_post("/guilds/{guild_id}/builds", _handle_builds_create)
    app.router.add_put("/guilds/{guild_id}/builds/{build_id}", _handle_builds_update)
    app.router.add_delete("/guilds/{guild_id}/builds/{build_id}", _handle_builds_delete)
```

If `storage.py` exposes `upsert_build`/`delete_build` helpers on `StorageManager` (it does per the builds cog — `find_build`, `upsert_build`, `delete_build`), prefer those over manual list manipulation; keep the response shapes identical.

- [ ] **Step 4: Run tests**

Run: `PYTHONPATH=. pytest tests/test_api_builds.py tests/test_api_server.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add axitools/api/server.py tests/test_api_builds.py
git commit -m "feat: builds CRUD endpoints on local API"
```

---

### Task 3: Comp presets + schedules + config endpoints

**Files:**
- Modify: `axitools/api/server.py`
- Test: `tests/test_api_comps.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_api_comps.py`:

```python
import pytest

from axitools.api.server import build_app
from axitools.storage import CompConfig, CompPreset

from tests.test_api_server import FakeBot, _auth

GID = 123


@pytest.fixture
def bot(tmp_path):
    return FakeBot(tmp_path)


@pytest.fixture
async def api_client(aiohttp_client, bot):
    app = build_app(bot, token="test-token")
    return await aiohttp_client(app)


async def test_comp_presets_crud(api_client, bot):
    resp = await api_client.get(f"/guilds/{GID}/comp-presets", headers=_auth())
    assert await resp.json() == []

    # create/replace by name (PUT semantics on collection: body carries name+config)
    preset_payload = {"name": "Tuesday WvW Raid", "config": CompConfig().to_dict() if hasattr(CompConfig(), "to_dict") else {}}
    resp = await api_client.put(
        f"/guilds/{GID}/comp-presets/Tuesday WvW Raid",
        json=preset_payload,
        headers=_auth(),
    )
    assert resp.status == 200
    names = [p.name for p in bot.storage.get_comp_presets(GID)]
    assert names == ["Tuesday WvW Raid"]

    resp = await api_client.get(f"/guilds/{GID}/comp-presets", headers=_auth())
    assert [p["name"] for p in await resp.json()] == ["Tuesday WvW Raid"]

    resp = await api_client.delete(
        f"/guilds/{GID}/comp-presets/Tuesday WvW Raid", headers=_auth()
    )
    assert resp.status == 204
    assert bot.storage.get_comp_presets(GID) == []


async def test_comp_schedules_listing(api_client, bot):
    resp = await api_client.get(f"/guilds/{GID}/comp-schedules", headers=_auth())
    assert resp.status == 200
    assert await resp.json() == []


async def test_config_excludes_secrets(api_client, bot):
    config = bot.storage.get_config(GID)
    config.audit_gw2_admin_api_key = "SECRET-KEY"
    bot.storage.save_config(GID, config)

    resp = await api_client.get(f"/guilds/{GID}/config", headers=_auth())
    body = await resp.json()
    assert "SECRET-KEY" not in str(body)
    assert "moderator_role_ids" in body
```

Note on `CompConfig().to_dict()`: check `axitools/storage.py` — `CompConfig` has `from_dict` and `copy`; if there is no `to_dict`, serialize with whatever the comps cog uses (`CompPreset.to_dict()["config"]` shape). Adjust the test to construct the payload the same way `CompPreset.to_dict()` emits it.

- [ ] **Step 2: Run to verify failure**

Run: `PYTHONPATH=. pytest tests/test_api_comps.py -v`
Expected: FAIL (404 routes)

- [ ] **Step 3: Implement handlers**

Add to `axitools/api/server.py` (import `CompPreset`, `CompSchedule` from `..storage`):

```python
async def _handle_presets_list(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    return web.json_response([p.to_dict() for p in bot.storage.get_comp_presets(gid)])


async def _handle_presets_put(request: web.Request) -> web.Response:
    """Create or replace a preset by name."""
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    name = request.match_info["name"]
    body = await request.json()
    body["name"] = name
    try:
        incoming = CompPreset.from_dict(body)
    except (KeyError, TypeError, ValueError) as exc:
        return web.json_response({"error": f"invalid preset: {exc}"}, status=400)
    presets = [p for p in bot.storage.get_comp_presets(gid) if p.name != name]
    presets.append(incoming)
    bot.storage.save_comp_presets(gid, presets)
    return web.json_response(incoming.to_dict())


async def _handle_presets_delete(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    name = request.match_info["name"]
    presets = bot.storage.get_comp_presets(gid)
    remaining = [p for p in presets if p.name != name]
    if len(remaining) == len(presets):
        return web.json_response({"error": "preset not found"}, status=404)
    bot.storage.save_comp_presets(gid, remaining)
    return web.Response(status=204)


async def _handle_schedules_list(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    config = bot.storage.get_config(gid)
    return web.json_response([s.to_dict() for s in config.comp_schedules])


async def _handle_schedules_put(request: web.Request) -> web.Response:
    """Create or replace a schedule by schedule_id."""
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    schedule_id = request.match_info["schedule_id"]
    body = await request.json()
    body["schedule_id"] = schedule_id
    try:
        incoming = CompSchedule.from_dict(body)
    except (KeyError, TypeError, ValueError) as exc:
        return web.json_response({"error": f"invalid schedule: {exc}"}, status=400)
    config = bot.storage.get_config(gid)
    config.comp_schedules = [s for s in config.comp_schedules if s.schedule_id != schedule_id]
    config.comp_schedules.append(incoming)
    bot.storage.save_config(gid, config)
    return web.json_response(incoming.to_dict())


_CONFIG_PUBLIC_FIELDS = (
    "moderator_role_ids",
    "build_channel_id",
    "comp_active_preset",
)


async def _handle_config_get(request: web.Request) -> web.Response:
    bot = request.app["bot"]
    gid = int(request.match_info["guild_id"])
    config = bot.storage.get_config(gid)
    body = {field: getattr(config, field) for field in _CONFIG_PUBLIC_FIELDS}
    body["comp_schedule_count"] = len(config.comp_schedules)
    return web.json_response(body)
```

Register in `build_app()`:

```python
    app.router.add_get("/guilds/{guild_id}/comp-presets", _handle_presets_list)
    app.router.add_put("/guilds/{guild_id}/comp-presets/{name}", _handle_presets_put)
    app.router.add_delete("/guilds/{guild_id}/comp-presets/{name}", _handle_presets_delete)
    app.router.add_get("/guilds/{guild_id}/comp-schedules", _handle_schedules_list)
    app.router.add_put("/guilds/{guild_id}/comp-schedules/{schedule_id}", _handle_schedules_put)
    app.router.add_get("/guilds/{guild_id}/config", _handle_config_get)
```

**Security invariant:** `_handle_config_get` must whitelist fields — `GuildConfig` contains `audit_gw2_admin_api_key`. Never serialize the whole dataclass.

- [ ] **Step 4: Run tests**

Run: `PYTHONPATH=. pytest tests/test_api_comps.py -v`
Expected: PASS

- [ ] **Step 5: Run the full axitools suite to check for regressions**

Run: `PYTHONPATH=. pytest tests -v`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add axitools/api/server.py tests/test_api_comps.py
git commit -m "feat: comp presets/schedules and config endpoints on local API"
```

---

### Task 4: Wire API into the bot lifecycle

**Files:**
- Modify: `axitools/bot.py`
- Modify: `README.md` (axitools)

- [ ] **Step 1: Start the API in `setup_hook`**

In `axitools/bot.py`, add to imports: `from .api.server import start_api`. In `AxiToolsBot.__init__`, add `self._api_runner = None`. At the end of `setup_hook()` (after the `load_extension` calls):

```python
        try:
            self._api_runner = await start_api(self)
        except OSError as exc:
            LOGGER.warning("AxiTools API failed to start: %s", exc)
```

Add cleanup by overriding `close()`:

```python
    async def close(self) -> None:
        if self._api_runner is not None:
            await self._api_runner.cleanup()
            self._api_runner = None
        await super().close()
```

- [ ] **Step 2: Document it**

Add a short section to the axitools `README.md`:

```markdown
## Local API (for GW2 Officer)

The bot serves a localhost-only HTTP API on port 8642 (override with
`AXITOOLS_API_PORT`). Requests need `Authorization: Bearer <token>`; the token
is read from `AXITOOLS_API_TOKEN` or auto-generated at `<data root>/api_token`
on first run. Copy that token into GW2 Officer's settings.
```

- [ ] **Step 3: Manual smoke test**

Run the bot (`python -m axitools` with a valid `DISCORD_TOKEN`), then:

```bash
TOKEN=$(cat axitools/data/api_token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8642/guilds
```

Expected: JSON array of the bot's Discord guilds. (If no Discord token available, skip and note it — covered by unit tests.)

- [ ] **Step 4: Commit**

```bash
git add axitools/bot.py README.md
git commit -m "feat: start local API in bot lifecycle"
```

---

# Part B — GW2 Officer Electron app

### Task 5: Scaffold electron-vite + React + TypeScript + Vitest

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore` (extend), `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Initialize the package**

Create `package.json`:

```json
{
  "name": "gw2-officer",
  "version": "0.1.0",
  "description": "Virtual officer for GW2 guild + Discord management",
  "main": "./out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run --pool=forks --poolOptions.forks.maxForks=2",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^33.0.0",
    "electron-vite": "^2.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

Run: `npm install`. If any version 404s, take the latest compatible (`npm info <pkg> version`) and note the substitution in the commit message.

- [ ] **Step 2: Configs**

Create `electron.vite.config.ts`:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*"]
}
```

Create `tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/renderer/src/**/*", "src/preload/index.d.ts"]
}
```

Append to `.gitignore`:

```
node_modules/
out/
dist/
```

- [ ] **Step 3: Minimal app shell**

Create `src/main/index.ts`:

```typescript
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#16171a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

Create `src/preload/index.ts`:

```typescript
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('officer', {})
```

Create `src/renderer/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>The Officer.</title>
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/renderer/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

Create `src/renderer/src/App.tsx`:

```tsx
export default function App(): JSX.Element {
  return <h1>The Officer.</h1>
}
```

- [ ] **Step 4: Verify it launches and typechecks**

Run: `npm run typecheck` — expected: clean.
Run: `npm run dev` — expected: a window opens showing "The Officer." (close it; in headless CI just check the build: `npm run build`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold electron-vite app shell"
```

---

### Task 6: Secrets store (safeStorage)

**Files:**
- Create: `src/main/secrets.ts`
- Test: `src/main/secrets.test.ts`

Secrets stored: `claudeOauthToken`, `gw2ApiKey`, `axitoolsToken`. Non-secret settings (axitools URL, guild id) live in the same JSON file unencrypted.

- [ ] **Step 1: Write the failing test**

Create `src/main/secrets.test.ts` — test the store against a fake cipher so the test doesn't need Electron:

```typescript
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SettingsStore, type Cipher } from './secrets'

const fakeCipher: Cipher = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`),
  decrypt: (buf) => buf.toString().replace(/^enc:/, '')
}

function makeStore(): SettingsStore {
  const dir = mkdtempSync(join(tmpdir(), 'gw2officer-'))
  return new SettingsStore(join(dir, 'settings.json'), fakeCipher)
}

describe('SettingsStore', () => {
  it('round-trips secrets through the cipher', () => {
    const store = makeStore()
    store.setSecret('gw2ApiKey', 'ABCD-1234')
    expect(store.getSecret('gw2ApiKey')).toBe('ABCD-1234')
  })

  it('persists across instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw2officer-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).setSecret('axitoolsToken', 'tok')
    expect(new SettingsStore(path, fakeCipher).getSecret('axitoolsToken')).toBe('tok')
  })

  it('does not write plaintext secrets to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw2officer-'))
    const path = join(dir, 'settings.json')
    new SettingsStore(path, fakeCipher).setSecret('gw2ApiKey', 'SUPERSECRET')
    const raw = require('fs').readFileSync(path, 'utf8')
    expect(raw).not.toContain('SUPERSECRET')
  })

  it('stores plain settings unencrypted', () => {
    const store = makeStore()
    store.setSetting('axitoolsUrl', 'http://127.0.0.1:8642')
    expect(store.getSetting('axitoolsUrl')).toBe('http://127.0.0.1:8642')
  })

  it('returns null for missing values', () => {
    const store = makeStore()
    expect(store.getSecret('claudeOauthToken')).toBeNull()
    expect(store.getSetting('guildId')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `./secrets`

- [ ] **Step 3: Implement**

Create `src/main/secrets.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export type SecretKey = 'claudeOauthToken' | 'gw2ApiKey' | 'axitoolsToken'
export type SettingKey = 'axitoolsUrl' | 'guildId' | 'gw2GuildId' | 'gw2AccountName'

export interface Cipher {
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

interface FileShape {
  secrets: Partial<Record<SecretKey, string>> // base64 of encrypted bytes
  settings: Partial<Record<SettingKey, string>>
}

export class SettingsStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher
  ) {}

  private read(): FileShape {
    if (!existsSync(this.path)) return { secrets: {}, settings: {} }
    return JSON.parse(readFileSync(this.path, 'utf8')) as FileShape
  }

  private write(data: FileShape): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  setSecret(key: SecretKey, value: string): void {
    const data = this.read()
    data.secrets[key] = this.cipher.encrypt(value).toString('base64')
    this.write(data)
  }

  getSecret(key: SecretKey): string | null {
    const stored = this.read().secrets[key]
    if (!stored) return null
    return this.cipher.decrypt(Buffer.from(stored, 'base64'))
  }

  setSetting(key: SettingKey, value: string): void {
    const data = this.read()
    data.settings[key] = value
    this.write(data)
  }

  getSetting(key: SettingKey): string | null {
    return this.read().settings[key] ?? null
  }
}

/** Production cipher backed by Electron safeStorage. Import lazily so tests
 *  (plain node) never load the electron module. */
export function electronCipher(): Cipher {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (buf) => safeStorage.decryptString(buf)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/secrets.ts src/main/secrets.test.ts
git commit -m "feat: encrypted settings store backed by safeStorage"
```

---

### Task 7: Axitools API client

**Files:**
- Create: `src/main/axitoolsClient.ts`
- Test: `src/main/axitoolsClient.test.ts`

- [ ] **Step 1: Write the failing test** (mock global `fetch`)

Create `src/main/axitoolsClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxitoolsClient, AxitoolsError } from './axitoolsClient'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('AxitoolsClient', () => {
  let client: AxitoolsClient

  beforeEach(() => {
    mockFetch.mockReset()
    client = new AxitoolsClient('http://127.0.0.1:8642', 'tok')
  })

  it('sends bearer auth and parses guild list', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ id: 123, name: 'Vigil Keep' }]))
    const guilds = await client.listGuilds()
    expect(guilds).toEqual([{ id: 123, name: 'Vigil Keep' }])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('creates a build via POST', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ build_id: 'abc', name: 'FB' }, 201))
    const build = await client.createBuild(123, { name: 'FB', profession: 'Guardian', chat_code: '[&x]' })
    expect(build.build_id).toBe('abc')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds/123/builds')
    expect(init.method).toBe('POST')
  })

  it('throws AxitoolsError with API message on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'build not found' }, 404))
    await expect(client.deleteBuild(123, 'zzz')).rejects.toThrow('build not found')
  })

  it('throws a connection error when the bot is down', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(client.listGuilds()).rejects.toThrow(AxitoolsError)
    await expect(client.listGuilds()).rejects.toThrow(/AxiTools bot.*reachable/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` — expected FAIL (module missing)

- [ ] **Step 3: Implement**

Create `src/main/axitoolsClient.ts`:

```typescript
export class AxitoolsError extends Error {}

export interface DiscordGuild { id: number; name: string }
export interface Build {
  build_id: string
  name: string
  profession: string
  specialization?: string | null
  url?: string | null
  chat_code: string
  description?: string | null
}
export interface CompPreset { name: string; config: Record<string, unknown> }
export interface CompSchedule {
  schedule_id: string
  name: string
  preset_name?: string | null
  post_days?: number[]
  post_time?: string | null
  timezone?: string
  [key: string]: unknown
}

export class AxitoolsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let resp: Response
    try {
      resp = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    } catch {
      throw new AxitoolsError(
        'The AxiTools bot is not reachable — is it running on this machine?'
      )
    }
    if (resp.status === 204) return undefined as T
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new AxitoolsError(
        (data as { error?: string }).error ?? `AxiTools API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  listGuilds(): Promise<DiscordGuild[]> {
    return this.request('GET', '/guilds')
  }

  listBuilds(guildId: number): Promise<Build[]> {
    return this.request('GET', `/guilds/${guildId}/builds`)
  }

  createBuild(guildId: number, build: Omit<Build, 'build_id'>): Promise<Build> {
    return this.request('POST', `/guilds/${guildId}/builds`, build)
  }

  updateBuild(guildId: number, buildId: string, patch: Partial<Build>): Promise<Build> {
    return this.request('PUT', `/guilds/${guildId}/builds/${buildId}`, patch)
  }

  deleteBuild(guildId: number, buildId: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/builds/${buildId}`)
  }

  listCompPresets(guildId: number): Promise<CompPreset[]> {
    return this.request('GET', `/guilds/${guildId}/comp-presets`)
  }

  putCompPreset(guildId: number, preset: CompPreset): Promise<CompPreset> {
    return this.request(
      'PUT',
      `/guilds/${guildId}/comp-presets/${encodeURIComponent(preset.name)}`,
      preset
    )
  }

  deleteCompPreset(guildId: number, name: string): Promise<void> {
    return this.request('DELETE', `/guilds/${guildId}/comp-presets/${encodeURIComponent(name)}`)
  }

  listCompSchedules(guildId: number): Promise<CompSchedule[]> {
    return this.request('GET', `/guilds/${guildId}/comp-schedules`)
  }

  putCompSchedule(guildId: number, schedule: CompSchedule): Promise<CompSchedule> {
    return this.request(
      'PUT',
      `/guilds/${guildId}/comp-schedules/${encodeURIComponent(schedule.schedule_id)}`,
      schedule
    )
  }
}
```

- [ ] **Step 4: Run tests** — `npm test`, expected PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/axitoolsClient.ts src/main/axitoolsClient.test.ts
git commit -m "feat: axitools API client"
```

---

### Task 8: GW2 API client

**Files:**
- Create: `src/main/gw2Client.ts`
- Test: `src/main/gw2Client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/gw2Client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Gw2Client, Gw2Error } from './gw2Client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Gw2Client', () => {
  let client: Gw2Client

  beforeEach(() => {
    mockFetch.mockReset()
    client = new Gw2Client('TEST-KEY')
  })

  it('validates the key via tokeninfo + account', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'x', name: 'officer', permissions: ['account', 'guilds'] }))
      .mockResolvedValueOnce(jsonResponse({ name: 'Darkharasho.4621', guilds: ['G-1'], guild_leader: ['G-1'] }))
    const info = await client.accountInfo()
    expect(info.accountName).toBe('Darkharasho.4621')
    expect(info.permissions).toContain('guilds')
    expect(info.missingPermissions).toEqual([])
    const firstUrl = mockFetch.mock.calls[0][0] as string
    expect(firstUrl).toBe('https://api.guildwars2.com/v2/tokeninfo')
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TEST-KEY')
  })

  it('reports missing permissions', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'x', name: 'k', permissions: ['account'] }))
      .mockResolvedValueOnce(jsonResponse({ name: 'A.1', guilds: [] }))
    const info = await client.accountInfo()
    expect(info.missingPermissions).toEqual(['guilds'])
  })

  it('fetches guild members', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ name: 'Riversong.2837', rank: 'Recruit', joined: '2026-06-09T00:00:00Z' }]))
    const members = await client.guildMembers('G-1')
    expect(members[0].name).toBe('Riversong.2837')
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.guildwars2.com/v2/guild/G-1/members')
  })

  it('surfaces API error text', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ text: 'Invalid access token' }, 401))
    await expect(client.guildMembers('G-1')).rejects.toThrow('Invalid access token')
  })

  it('surfaces rate limiting', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 429 }))
    await expect(client.guildMembers('G-1')).rejects.toThrow(Gw2Error)
    mockFetch.mockResolvedValue(new Response('', { status: 429 }))
    await expect(client.guildMembers('G-1')).rejects.toThrow(/rate limit/i)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm test`, FAIL (module missing)

- [ ] **Step 3: Implement**

Create `src/main/gw2Client.ts`:

```typescript
const BASE = 'https://api.guildwars2.com/v2'
const REQUIRED_PERMISSIONS = ['account', 'guilds'] as const

export class Gw2Error extends Error {}

export interface AccountInfo {
  accountName: string
  permissions: string[]
  missingPermissions: string[]
  guilds: string[]
  guildLeader: string[]
}

export interface GuildMember {
  name: string
  rank: string
  joined: string | null
}

export interface GuildLogEntry {
  id: number
  time: string
  type: string
  user?: string
  [key: string]: unknown
}

export class Gw2Client {
  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string): Promise<T> {
    let resp: Response
    try {
      resp = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      })
    } catch {
      throw new Gw2Error('Could not reach the GW2 API — check your network connection.')
    }
    if (resp.status === 429) {
      throw new Gw2Error('GW2 API rate limit hit — wait a minute and try again.')
    }
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      throw new Gw2Error(
        (data as { text?: string }).text ?? `GW2 API error (HTTP ${resp.status})`
      )
    }
    return data as T
  }

  async accountInfo(): Promise<AccountInfo> {
    const token = await this.get<{ permissions: string[] }>('/tokeninfo')
    const account = await this.get<{ name: string; guilds?: string[]; guild_leader?: string[] }>('/account')
    return {
      accountName: account.name,
      permissions: token.permissions,
      missingPermissions: REQUIRED_PERMISSIONS.filter((p) => !token.permissions.includes(p)),
      guilds: account.guilds ?? [],
      guildLeader: account.guild_leader ?? []
    }
  }

  guildMembers(guildId: string): Promise<GuildMember[]> {
    return this.get(`/guild/${guildId}/members`)
  }

  guildLog(guildId: string, sinceLogId?: number): Promise<GuildLogEntry[]> {
    const qs = sinceLogId !== undefined ? `?since=${sinceLogId}` : ''
    return this.get(`/guild/${guildId}/log${qs}`)
  }
}
```

- [ ] **Step 4: Run tests** — `npm test`, expected PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/gw2Client.ts src/main/gw2Client.test.ts
git commit -m "feat: GW2 API client"
```

---

### Task 9: MCP toolset

**Files:**
- Create: `src/main/tools.ts`
- Test: `src/main/tools.test.ts`

The toolset wraps both clients with `tool()` from the Agent SDK. Tools return text content; JSON payloads are stringified so the agent can read them. Destructive tools are listed in `DESTRUCTIVE_TOOLS` for the confirm gate (Task 10).

- [ ] **Step 1: Write the failing test**

Create `src/main/tools.test.ts` — exercise tool handlers directly through the deps object (don't spin up the SDK):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, type ToolDeps } from './tools'

function makeDeps(): ToolDeps {
  return {
    axitools: {
      listGuilds: vi.fn().mockResolvedValue([{ id: 123, name: 'Vigil Keep' }]),
      listBuilds: vi.fn().mockResolvedValue([]),
      createBuild: vi.fn().mockResolvedValue({ build_id: 'b1', name: 'FB' }),
      updateBuild: vi.fn(),
      deleteBuild: vi.fn().mockResolvedValue(undefined),
      listCompPresets: vi.fn().mockResolvedValue([]),
      putCompPreset: vi.fn(),
      deleteCompPreset: vi.fn(),
      listCompSchedules: vi.fn().mockResolvedValue([]),
      putCompSchedule: vi.fn()
    } as never,
    gw2: {
      accountInfo: vi.fn().mockResolvedValue({ accountName: 'A.1', permissions: [], missingPermissions: [], guilds: [], guildLeader: [] }),
      guildMembers: vi.fn().mockResolvedValue([{ name: 'R.1', rank: 'Member', joined: null }]),
      guildLog: vi.fn().mockResolvedValue([])
    } as never,
    discordGuildId: () => 123,
    gw2GuildId: () => 'G-1'
  }
}

describe('officer tools', () => {
  it('exposes the expected tool names', () => {
    const tools = buildOfficerTools(makeDeps())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'axitools_builds_list',
        'axitools_builds_create',
        'axitools_builds_update',
        'axitools_builds_delete',
        'axitools_comp_presets_list',
        'axitools_comp_presets_save',
        'axitools_comp_presets_delete',
        'axitools_comp_schedules_list',
        'axitools_comp_schedules_save',
        'gw2_account_info',
        'gw2_guild_members',
        'gw2_guild_log'
      ])
    )
  })

  it('marks deletes destructive', () => {
    expect(DESTRUCTIVE_TOOLS).toContain('axitools_builds_delete')
    expect(DESTRUCTIVE_TOOLS).toContain('axitools_comp_presets_delete')
  })

  it('builds_create calls the client with the active guild', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const create = tools.find((t) => t.name === 'axitools_builds_create')!
    const result = await create.handler(
      { name: 'FB', profession: 'Guardian', chat_code: '[&x]' },
      {}
    )
    expect(deps.axitools.createBuild).toHaveBeenCalledWith(123, expect.objectContaining({ name: 'FB' }))
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toContain('b1')
  })

  it('gw2_guild_members uses the configured GW2 guild', async () => {
    const deps = makeDeps()
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({}, {})
    expect(deps.gw2.guildMembers).toHaveBeenCalledWith('G-1')
    expect((result.content[0] as { text: string }).text).toContain('R.1')
  })

  it('tool errors come back as is_error text, not exceptions', async () => {
    const deps = makeDeps()
    ;(deps.gw2.guildMembers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    const tools = buildOfficerTools(deps)
    const members = tools.find((t) => t.name === 'gw2_guild_members')!
    const result = await members.handler({}, {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('boom')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm test`, FAIL

- [ ] **Step 3: Implement**

Create `src/main/tools.ts`:

```typescript
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AxitoolsClient } from './axitoolsClient'
import type { Gw2Client } from './gw2Client'

export interface ToolDeps {
  axitools: AxitoolsClient
  gw2: Gw2Client
  /** active Discord guild id from settings */
  discordGuildId: () => number
  /** active GW2 guild id from settings */
  gw2GuildId: () => string
}

export const DESTRUCTIVE_TOOLS = ['axitools_builds_delete', 'axitools_comp_presets_delete']

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function wrap<A>(fn: (args: A) => Promise<unknown>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }]
      }
    }
  }
}

export function buildOfficerTools(deps: ToolDeps) {
  const gid = deps.discordGuildId

  return [
    tool(
      'axitools_builds_list',
      'List all GW2 builds stored in the AxiTools Discord bot for this guild.',
      {},
      wrap(() => deps.axitools.listBuilds(gid()))
    ),
    tool(
      'axitools_builds_create',
      'Add a new build to AxiTools. Requires name, profession, and chat_code.',
      {
        name: z.string(),
        profession: z.string().describe('Base profession, e.g. Guardian'),
        specialization: z.string().optional().describe('Elite spec, e.g. Firebrand'),
        chat_code: z.string().describe('In-game build template chat code, e.g. [&DQE...]'),
        url: z.string().optional().describe('Link to the build guide'),
        description: z.string().optional()
      },
      wrap((args) => deps.axitools.createBuild(gid(), args))
    ),
    tool(
      'axitools_builds_update',
      'Update fields of an existing build by build_id. Only pass fields to change.',
      {
        build_id: z.string(),
        name: z.string().optional(),
        profession: z.string().optional(),
        specialization: z.string().optional(),
        chat_code: z.string().optional(),
        url: z.string().optional(),
        description: z.string().optional()
      },
      wrap(({ build_id, ...patch }) => deps.axitools.updateBuild(gid(), build_id, patch))
    ),
    tool(
      'axitools_builds_delete',
      'Permanently delete a build by build_id. Destructive — the user will be asked to confirm.',
      { build_id: z.string() },
      wrap(async ({ build_id }) => {
        await deps.axitools.deleteBuild(gid(), build_id)
        return { deleted: build_id }
      })
    ),
    tool(
      'axitools_comp_presets_list',
      'List squad composition presets (named rosters of classes/counts) from AxiTools.',
      {},
      wrap(() => deps.axitools.listCompPresets(gid()))
    ),
    tool(
      'axitools_comp_presets_save',
      'Create or replace a comp preset. Pass the FULL preset (name + config). To edit, first list presets, modify the config object, then save it back.',
      {
        name: z.string(),
        config: z.record(z.unknown()).describe('CompConfig object as returned by axitools_comp_presets_list')
      },
      wrap((preset) => deps.axitools.putCompPreset(gid(), preset as never))
    ),
    tool(
      'axitools_comp_presets_delete',
      'Permanently delete a comp preset by name. Destructive — the user will be asked to confirm.',
      { name: z.string() },
      wrap(async ({ name }) => {
        await deps.axitools.deleteCompPreset(gid(), name)
        return { deleted: name }
      })
    ),
    tool(
      'axitools_comp_schedules_list',
      'List recurring comp posting schedules (which preset posts on which days/times).',
      {},
      wrap(() => deps.axitools.listCompSchedules(gid()))
    ),
    tool(
      'axitools_comp_schedules_save',
      'Create or replace a comp schedule. Pass the FULL schedule object (schedule_id, name, preset_name, post_days as weekday ints 0=Mon, post_time HH:MM, timezone).',
      {
        schedule_id: z.string(),
        name: z.string(),
        preset_name: z.string().optional(),
        post_days: z.array(z.number()).optional(),
        post_time: z.string().optional(),
        timezone: z.string().optional()
      },
      wrap((schedule) => deps.axitools.putCompSchedule(gid(), schedule as never))
    ),
    tool(
      'gw2_account_info',
      "Validate the stored GW2 API key: returns account name, the key's permissions, missing required permissions, and account guild IDs.",
      {},
      wrap(() => deps.gw2.accountInfo())
    ),
    tool(
      'gw2_guild_members',
      'Fetch the GW2 guild roster: account names, ranks, and join dates.',
      {},
      wrap(() => deps.gw2.guildMembers(deps.gw2GuildId()))
    ),
    tool(
      'gw2_guild_log',
      'Fetch the GW2 guild activity log (joins, kicks, invites, rank changes, stash/treasury). Optionally pass since_log_id to get only newer entries.',
      { since_log_id: z.number().optional() },
      wrap(({ since_log_id }) => deps.gw2.guildLog(deps.gw2GuildId(), since_log_id))
    )
  ]
}
```

Note: if the SDK's `SdkMcpToolDefinition` doesn't expose `.handler`/`.name` publicly, adapt the test to whatever the returned object exposes (inspect `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) — keep the behavior assertions, change only the access path.

- [ ] **Step 4: Run tests** — `npm test`, expected PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/tools.ts src/main/tools.test.ts
git commit -m "feat: officer MCP toolset"
```

---

### Task 10: Agent service — query() loop, IPC streaming, confirm gate

**Files:**
- Create: `src/main/agent.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/preload/index.d.ts`

No unit test for the SDK loop itself (it spawns the Claude runtime); the translation function gets a test in Step 1.

- [ ] **Step 1: Write the failing test for event translation**

Create `src/main/agentEvents.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { translateSdkMessage } from './agent'

describe('translateSdkMessage', () => {
  it('extracts text deltas from partial stream events', () => {
    const events = translateSdkMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    } as never)
    expect(events).toEqual([{ kind: 'text-delta', text: 'Hello' }])
  })

  it('extracts tool_use blocks from assistant messages', () => {
    const events = translateSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 't1', name: 'mcp__officer__axitools_builds_list', input: {} }
        ]
      }
    } as never)
    expect(events).toContainEqual({
      kind: 'tool-start',
      id: 't1',
      name: 'axitools_builds_list',
      input: {}
    })
  })

  it('extracts tool results from user messages', () => {
    const events = translateSdkMessage({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: false, content: [{ type: 'text', text: '[]' }] }
        ]
      }
    } as never)
    expect(events).toContainEqual({ kind: 'tool-result', id: 't1', isError: false, text: '[]' })
  })

  it('emits done on result messages', () => {
    const events = translateSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'All done.',
      session_id: 's-1'
    } as never)
    expect(events).toEqual([{ kind: 'done', sessionId: 's-1', error: null }])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npm test`, FAIL

- [ ] **Step 3: Implement the agent service**

Create `src/main/agent.ts`:

```typescript
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { buildOfficerTools, DESTRUCTIVE_TOOLS, type ToolDeps } from './tools'

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; error: string | null }

const OFFICER_SYSTEM_PROMPT = `You are The Officer — a virtual guild officer for a Guild Wars 2 guild.
You manage builds and squad compositions through the AxiTools Discord bot, and
inspect the guild roster and activity log through the official GW2 API.

Rules:
- Before editing a comp preset, list presets first and modify the returned
  config object — presets are saved whole, never patched blind.
- After any change, state exactly what changed (old value → new value).
- If a tool reports the AxiTools bot is unreachable or a GW2 API key problem,
  report it plainly and do not retry more than once.
- Profession names matter: distinguish base professions (Necromancer) from
  elite specs (Scourge, Reaper, Harbinger).
- Keep replies concise; lead with the outcome. The UI renders your reply as a
  newspaper article, so a strong first sentence works as the headline.`

/** Pure translation from SDK messages to renderer events (unit-tested). */
export function translateSdkMessage(msg: Record<string, unknown>): AgentEvent[] {
  const events: AgentEvent[] = []
  if (msg.type === 'stream_event') {
    const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } }
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      events.push({ kind: 'text-delta', text: ev.delta.text })
    }
  } else if (msg.type === 'assistant') {
    const content = (msg.message as { content?: unknown[] })?.content ?? []
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use') {
        events.push({
          kind: 'tool-start',
          id: String(block.id),
          name: String(block.name).replace(/^mcp__officer__/, ''),
          input: (block.input ?? {}) as Record<string, unknown>
        })
      }
    }
  } else if (msg.type === 'user') {
    const content = (msg.message as { content?: unknown[] })?.content ?? []
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_result') {
        const inner = block.content
        const text = Array.isArray(inner)
          ? inner
              .filter((c): c is { type: string; text: string } => (c as { type?: string }).type === 'text')
              .map((c) => c.text)
              .join('\n')
          : String(inner ?? '')
        events.push({
          kind: 'tool-result',
          id: String(block.tool_use_id),
          isError: Boolean(block.is_error),
          text
        })
      }
    }
  } else if (msg.type === 'result') {
    events.push({
      kind: 'done',
      sessionId: (msg.session_id as string) ?? null,
      error: msg.subtype === 'success' ? null : `Agent error: ${String(msg.subtype)}`
    })
  }
  return events
}

export interface AgentDeps {
  toolDeps: ToolDeps
  oauthToken: () => string | null
  /** Ask the user to confirm a destructive tool call. Resolves true to allow. */
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

export class AgentService {
  private sessionId: string | null = null

  constructor(private readonly deps: AgentDeps) {}

  resetSession(): void {
    this.sessionId = null
  }

  async runTurn(promptText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    const tools = buildOfficerTools(this.deps.toolDeps)
    const server = createSdkMcpServer({ name: 'officer', version: '1.0.0', tools })
    const allowedTools = tools.map((t) => `mcp__officer__${t.name}`)

    const token = this.deps.oauthToken()
    const env: Record<string, string | undefined> = { ...process.env }
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token

    try {
      const q = query({
        prompt: promptText,
        options: {
          mcpServers: { officer: server },
          allowedTools,
          systemPrompt: OFFICER_SYSTEM_PROMPT,
          includePartialMessages: true,
          permissionMode: 'default',
          env,
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          canUseTool: async (toolName, input) => {
            const bare = toolName.replace(/^mcp__officer__/, '')
            if (DESTRUCTIVE_TOOLS.includes(bare)) {
              const allowed = await this.deps.confirm(bare, input)
              if (!allowed) {
                return { behavior: 'deny', message: 'The user declined this action.' }
              }
            }
            return { behavior: 'allow', updatedInput: input }
          }
        }
      })

      for await (const msg of q) {
        for (const event of translateSdkMessage(msg as unknown as Record<string, unknown>)) {
          if (event.kind === 'done' && event.sessionId) this.sessionId = event.sessionId
          onEvent(event)
        }
      }
    } catch (err) {
      onEvent({
        kind: 'done',
        sessionId: this.sessionId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
```

Note: verify the `Options` type accepts `env` (check `sdk.d.ts`); if it doesn't, set `process.env.CLAUDE_CODE_OAUTH_TOKEN = token` before calling `query()` instead.

- [ ] **Step 4: Wire IPC in main**

Rewrite `src/main/index.ts`:

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { SettingsStore, electronCipher, type SecretKey, type SettingKey } from './secrets'
import { AxitoolsClient } from './axitoolsClient'
import { Gw2Client } from './gw2Client'
import { AgentService } from './agent'

let win: BrowserWindow | null = null
let store: SettingsStore
let agent: AgentService

const pendingConfirms = new Map<string, (allowed: boolean) => void>()

function makeAgent(): AgentService {
  return new AgentService({
    oauthToken: () => store.getSecret('claudeOauthToken'),
    confirm: (toolName, input) =>
      new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2)
        pendingConfirms.set(id, resolve)
        win?.webContents.send('agent:confirm-request', { id, toolName, input })
      }),
    toolDeps: {
      get axitools() {
        return new AxitoolsClient(
          store.getSetting('axitoolsUrl') ?? 'http://127.0.0.1:8642',
          store.getSecret('axitoolsToken') ?? ''
        )
      },
      get gw2() {
        return new Gw2Client(store.getSecret('gw2ApiKey') ?? '')
      },
      discordGuildId: () => Number(store.getSetting('guildId') ?? 0),
      gw2GuildId: () => store.getSetting('gw2GuildId') ?? ''
    }
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#16171a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  store = new SettingsStore(join(app.getPath('userData'), 'settings.json'), electronCipher())
  agent = makeAgent()

  ipcMain.handle('settings:get', (_e, key: SettingKey) => store.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: SettingKey, value: string) => store.setSetting(key, value))
  ipcMain.handle('secrets:set', (_e, key: SecretKey, value: string) => store.setSecret(key, value))
  ipcMain.handle('secrets:has', (_e, key: SecretKey) => store.getSecret(key) !== null)

  ipcMain.handle('gw2:validate-key', async () => {
    const key = store.getSecret('gw2ApiKey')
    if (!key) return { ok: false, error: 'No GW2 API key saved yet.' }
    try {
      return { ok: true, info: await new Gw2Client(key).accountInfo() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('axitools:status', async () => {
    try {
      const client = new AxitoolsClient(
        store.getSetting('axitoolsUrl') ?? 'http://127.0.0.1:8642',
        store.getSecret('axitoolsToken') ?? ''
      )
      return { ok: true, guilds: await client.listGuilds() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:send', async (_e, text: string) => {
    await agent.runTurn(text, (event) => win?.webContents.send('agent:event', event))
  })
  ipcMain.handle('agent:reset', () => agent.resetSession())
  ipcMain.on('agent:confirm-response', (_e, { id, allowed }: { id: string; allowed: boolean }) => {
    pendingConfirms.get(id)?.(allowed)
    pendingConfirms.delete(id)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 5: Preload bridge**

Rewrite `src/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('officer', {
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  setSecret: (key: string, value: string) => ipcRenderer.invoke('secrets:set', key, value),
  hasSecret: (key: string) => ipcRenderer.invoke('secrets:has', key),
  validateGw2Key: () => ipcRenderer.invoke('gw2:validate-key'),
  axitoolsStatus: () => ipcRenderer.invoke('axitools:status'),
  sendMessage: (text: string) => ipcRenderer.invoke('agent:send', text),
  resetSession: () => ipcRenderer.invoke('agent:reset'),
  onAgentEvent: (cb: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown): void => cb(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onConfirmRequest: (cb: (req: unknown) => void) => {
    const listener = (_e: unknown, req: unknown): void => cb(req)
    ipcRenderer.on('agent:confirm-request', listener)
    return () => ipcRenderer.removeListener('agent:confirm-request', listener)
  },
  respondConfirm: (id: string, allowed: boolean) =>
    ipcRenderer.send('agent:confirm-response', { id, allowed })
})
```

Create `src/preload/index.d.ts`:

```typescript
export interface OfficerApi {
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  setSecret(key: string, value: string): Promise<void>
  hasSecret(key: string): Promise<boolean>
  validateGw2Key(): Promise<{ ok: boolean; info?: unknown; error?: string }>
  axitoolsStatus(): Promise<{ ok: boolean; guilds?: Array<{ id: number; name: string }>; error?: string }>
  sendMessage(text: string): Promise<void>
  resetSession(): Promise<void>
  onAgentEvent(cb: (event: unknown) => void): () => void
  onConfirmRequest(cb: (req: unknown) => void): () => void
  respondConfirm(id: string, allowed: boolean): void
}

declare global {
  interface Window {
    officer: OfficerApi
  }
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS / clean. Fix type errors against the actual SDK types as needed.

- [ ] **Step 7: Commit**

```bash
git add src/main src/preload
git commit -m "feat: agent service with query() loop, IPC streaming, destructive-tool confirm gate"
```

---

### Task 11: Renderer — Dark Newsprint Gazette UI

**Files:**
- Create: `src/renderer/src/theme.css`
- Create: `src/renderer/src/state.ts`
- Create: `src/renderer/src/components/Masthead.tsx`
- Create: `src/renderer/src/components/Rails.tsx`
- Create: `src/renderer/src/components/Article.tsx`
- Create: `src/renderer/src/components/ToolCoupon.tsx`
- Create: `src/renderer/src/components/InputBar.tsx`
- Create: `src/renderer/src/components/ConfirmDialog.tsx`
- Create: `src/renderer/src/components/Settings.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/index.html`

This implements the locked visual direction in the spec (`docs/superpowers/specs/2026-06-11-gw2-officer-design.md` → "Dark Newsprint Gazette"). Follow the spec's anatomy exactly. **No scissor icons.**

- [ ] **Step 1: Fonts**

In `src/renderer/index.html` `<head>`, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;0,900;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

(If you prefer offline-safe, download the woff2 files into `src/renderer/src/assets/fonts/` and use `@font-face`; either is acceptable — note the choice in the commit.)

- [ ] **Step 2: Theme**

Create `src/renderer/src/theme.css` with the spec's palette tokens and component styles. Start from this base (the approved mock's CSS, classnames kebab-cased) and keep it organized by component:

```css
:root {
  --bg: #16171a; --bg2: #1b1c20; --paper: #1f2025;
  --line: #2e3036; --rule: #3a3d44; --rule2: #46494f;
  --ink: #e4e3dc; --ink-dim: #a6a69e; --faint: #6a6b6e;
  --accent: #c8423a; --accent-b: #e05a50; --green: #6fae6f;
  --font-display: 'Playfair Display', serif;
  --font-body: 'Source Serif 4', serif;
  --font-mono: 'IBM Plex Mono', monospace;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body, #root { height: 100%; }

body {
  font-family: var(--font-body);
  color: var(--ink);
  background:
    radial-gradient(1100px 500px at 50% -15%, rgba(255,255,255,.03), transparent),
    repeating-linear-gradient(0deg, transparent 0 1px, rgba(0,0,0,.05) 1px 2px),
    linear-gradient(180deg, #17181c, #121316);
  overflow: hidden;
}

/* scrollbars — thin flat rail, crimson on hover */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; border-left: 1px dashed var(--line); }
::-webkit-scrollbar-thumb { background: var(--rule); border: 2px solid #16171a; }
::-webkit-scrollbar-thumb:hover { background: var(--accent); }
* { scrollbar-width: thin; scrollbar-color: #3a3d44 transparent; }
```

Then add the masthead, rails, folio, rip separator, user clipping (torn bottom edge via `clip-path` polygon), article (kicker/lede/byline/drop cap/end-mark ∎), tool coupon (dashed border, dotted inner rules, table styles), torn-edge input zone, and confirm-dialog styles. **The approved mock at `docs/superpowers/specs/2026-06-11-gazette-mock.html` is the source of truth** — open it in a browser to see the target, and copy its CSS values (clip-path polygons, spacing, font sizes) verbatim into `theme.css`, renaming classes as needed for the components below.

- [ ] **Step 3: Chat state**

Create `src/renderer/src/state.ts`:

```typescript
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  resultText?: string
  isError?: boolean
}

export interface Turn {
  id: number
  userText: string
  agentText: string
  tools: ToolCall[]
  done: boolean
  error: string | null
  filedAt: string // e.g. "9:42 pm"
}

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; error: string | null }

export function applyEvent(turn: Turn, event: AgentEvent): Turn {
  switch (event.kind) {
    case 'text-delta':
      return { ...turn, agentText: turn.agentText + event.text }
    case 'tool-start':
      return { ...turn, tools: [...turn.tools, { id: event.id, name: event.name, input: event.input }] }
    case 'tool-result':
      return {
        ...turn,
        tools: turn.tools.map((t) =>
          t.id === event.id ? { ...t, resultText: event.text, isError: event.isError } : t
        )
      }
    case 'done':
      return { ...turn, done: true, error: event.error }
  }
}
```

Optionally add `src/renderer/src/state.test.ts` mirroring the reducer cases (include it in vitest's `include` glob if so).

- [ ] **Step 4: Components**

Implement the components per the spec anatomy. Key structural points (full JSX is the implementer's to write, styled by `theme.css`):

- `Masthead.tsx`: hat line (`Vol. II · No. <issue>` left, `Final Edition · Free to Members` right), center nameplate `The Officer<em>.</em>`, left ear = AxiTools/GW2 API status (poll `window.officer.axitoolsStatus()` / `validateGw2Key()` on mount, green ● when ok), right ear = guild name + Claude status, nav tabs `01 Dispatches … 05 Settings` (only Dispatches and Settings functional in MVP; others render dimmed).
- `Rails.tsx`: left "In This Issue" and right "Notices" rails; MVP renders static placeholders fed by the axitools status payload (guild count, builds count if cheaply available) — keep the component API ready for live data in Phase 3.
- `Article.tsx`: renders one `Turn` — the user clipping ("From the Commander's Desk", italic, torn bottom edge), the rip separator ("THE OFFICER REPORTS"), then the agent article. Headline = first sentence of `agentText` (split on first `.` or newline) in Playfair 700; byline `By The Officer · filed {filedAt} · {tools.length} actions taken`; body = remaining text with drop cap on first paragraph; ∎ end-mark when `done`. Tool coupons interleave before the closing prose (render them after the headline block, in order).
- `ToolCoupon.tsx`: dashed box; header label derived from the tool name (`axitools_comp_presets_save` → `COMPS / SAVE PRESET`, `gw2_guild_log` → `GW2 / GUILD LOG`); status `… working` until `resultText` arrives, then `✓ filed` (green) or `✗ failed` (crimson); body shows a compact rendering of the result — arrays of objects render as a dotted-rule table of their keys, other JSON as `<pre>`, errors as plain crimson text. Collapse bodies longer than ~12 rows behind a "show all" toggle.
- `InputBar.tsx`: torn top edge zone, `>` prompt, dashed-underline `<input>` ("File your orders…"), crimson SEND stamp button; Enter submits; disabled while a turn is running.
- `ConfirmDialog.tsx`: modal styled as a public notice ("NOTICE OF DESTRUCTION" header, the tool name + input rendered as a coupon, APPROVE/DENY stamp buttons); listens via `window.officer.onConfirmRequest`, responds with `respondConfirm(id, allowed)`.
- `Settings.tsx` (section 05): fields for Claude OAuth token (with instructions: run `claude setup-token` in a terminal and paste the token; show "using existing Claude Code login" hint if no token saved but agent works), GW2 API key (validate button → shows account name + permission check via `validateGw2Key`), AxiTools URL + token (test button → guild list, with a guild picker that stores `guildId`), and GW2 guild ID (offer the IDs returned by key validation).

- `App.tsx`: holds `turns`, current section ('dispatches' | 'settings'), subscribes to `window.officer.onAgentEvent` and folds events into the last turn with `applyEvent`; `filedAt` = `new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`; folio header shows the date line (`Thursday, 11 June 2026 · Evening Edition` style via `toLocaleDateString`).

- [ ] **Step 5: Run it**

Run: `npm run typecheck && npm test` — clean.
Run: `npm run dev` — verify: masthead + rails + folio render per spec; typing a message appends a clipping and streams an article reply (requires Claude auth working; if not configured, the done-event error must render as a crimson notice in the article body, not crash).

- [ ] **Step 6: Visual check against the spec**

Compare the running app to the spec's "Dark Newsprint Gazette" bullet list, item by item (masthead ears, dashed rules, torn edges, coupons without scissors, styled scrollbar, stamp button). Fix discrepancies.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat: Dark Newsprint Gazette chat UI"
```

---

### Task 12: End-to-end verification

**Files:** none (verification + fixes only)

- [ ] **Step 1: Full test suites**

```bash
# Part B
npm test && npm run typecheck && npm run build
# Part A (in ../axitools)
cd ../axitools && PYTHONPATH=. pytest tests -v
```

Expected: all green.

- [ ] **Step 2: Live end-to-end**

With the axitools bot running and real credentials in Settings:

1. Settings → paste AxiTools token (from `axitools/data/api_token`) → Test → guild list appears → pick guild.
2. Settings → paste GW2 API key → Validate → account name + permissions shown.
3. Settings → Claude auth confirmed (token pasted or existing login detected).
4. Dispatches → "list our builds" → coupon `AXITOOLS / LIST BUILDS` ✓, article summarizes.
5. "add a build called Test Scrapper, engineer, chat code [&DQMGOyYvOitDAAAAswAAAJsAAACTAQAAvQEAAAAAAAAAAAAAAAAAAAAAAAA=]" → build appears via `/builds` in Discord.
6. "delete the Test Scrapper build" → NOTICE OF DESTRUCTION dialog appears → Approve → deleted.
7. "who joined the guild this week?" → `GW2 / GUILD LOG` coupon with table.
8. Quit and relaunch → secrets persist; new conversation works.

- [ ] **Step 3: Fix anything that failed, re-run, commit fixes**

```bash
git add -A && git commit -m "fix: end-to-end hardening"
```

- [ ] **Step 4: Update README**

Write `README.md`: what the app is, prerequisites (axitools bot running with the API module, Claude subscription, GW2 API key with `account`+`guilds`), setup steps, dev commands. Commit.
