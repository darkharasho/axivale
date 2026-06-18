# Lightweight Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, vitest-native eval layer that guards three LLM/extraction behaviors — source labeling, gear extraction, and comp structure — with replay-by-default fixtures and opt-in live model runs.

**Architecture:** An "eval" is a `*.eval.test.ts` file plus a fixture corpus under `src/main/meta/__evals__/`. A small harness replays recorded fixtures by default (offline, deterministic, runs in `npm test`), and only calls real models when `EVAL_LIVE=1`/`EVAL_RECORD=1`. Grading is assertion-based — no LLM judge. Production code (`distill`, `scrapeBuildGear`, `checkComp`) is already dependency-injectable, so no production refactor is needed.

**Tech Stack:** TypeScript (ESM), vitest, node `fs`/`path`/`url`, `@anthropic-ai/claude-agent-sdk` (already a dep, via existing `runClaudeOnce`).

## Global Constraints

- **Test runner:** vitest with `pool: 'forks'`, `maxForks: 2` (already set in `vitest.config.ts` — do not raise). Run targeted: `npx vitest run <path> --maxWorkers=2`.
- **ESM only:** `package.json` has `"type": "module"`. Use `import`, and `fileURLToPath(import.meta.url)` for dirname — never `__dirname`.
- **Eval file naming:** `*.eval.test.ts` so the existing vitest `include` glob (`src/**/*.test.{ts,tsx}`) picks them up. They MUST pass in replay mode under plain `npm test`.
- **Default mode is replay.** Live/record modes are reached ONLY via `EVAL_LIVE=1` or `EVAL_RECORD=1`. A missing token or network must never break `npm test`.
- **Grading is assertion-based only.** No LLM-as-judge.
- **Live model is wired to app config:** provider + model resolved from the app's `settings.json` (env-overridable); the OAuth secret falls back to an env var because Electron `safeStorage` can't decrypt headless.
- **Fixtures are committed** so CI is offline. `EVAL_RECORD=1` refreshes them (source-labeling only in this cut); gear fixtures are hand-maintained JSON.

---

### Task 1: Eval harness core (modes, fixtures, fixtureModel)

**Files:**
- Create: `src/main/meta/__evals__/harness.ts`
- Test: `src/main/meta/__evals__/harness.test.ts`
- Modify: `package.json` (add `eval`, `eval:record` scripts)

**Interfaces:**
- Consumes: `MetaModel` from `src/main/meta/distill.ts` (`type MetaModel = (prompt: string) => Promise<string>`).
- Produces:
  - `type EvalMode = 'replay' | 'live' | 'record'`
  - `evalMode(): EvalMode`
  - `fixturePath(group: string, id: string, ext: string): string`
  - `loadFixture(group: string, id: string, ext: string): string | null`
  - `saveFixture(group: string, id: string, ext: string, data: string): void`
  - `fixtureModel(group: string, id: string, live?: MetaModel): MetaModel`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/__evals__/harness.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { evalMode, fixturePath, loadFixture, saveFixture, fixtureModel } from './harness'

const GROUP = '__selftest__'
const ID = 'case-a'

afterEach(() => {
  const p = fixturePath(GROUP, ID, 'txt')
  if (existsSync(p)) rmSync(p)
  delete process.env.EVAL_LIVE
  delete process.env.EVAL_RECORD
})

describe('evalMode', () => {
  it('defaults to replay; EVAL_LIVE=live; EVAL_RECORD wins', () => {
    expect(evalMode()).toBe('replay')
    process.env.EVAL_LIVE = '1'
    expect(evalMode()).toBe('live')
    process.env.EVAL_RECORD = '1'
    expect(evalMode()).toBe('record')
  })
})

describe('fixtureModel', () => {
  it('replays a saved fixture and ignores the live model', async () => {
    saveFixture(GROUP, ID, 'txt', 'recorded-output')
    const model = fixtureModel(GROUP, ID, async () => 'LIVE')
    expect(await model('any prompt')).toBe('recorded-output')
  })

  it('throws a helpful error when the fixture is missing in replay mode', async () => {
    const model = fixtureModel(GROUP, ID)
    await expect(model('p')).rejects.toThrow(/missing fixture/i)
  })

  it('record mode calls live and writes the fixture', async () => {
    process.env.EVAL_RECORD = '1'
    const model = fixtureModel(GROUP, ID, async () => 'fresh-from-model')
    expect(await model('p')).toBe('fresh-from-model')
    expect(loadFixture(GROUP, ID, 'txt')).toBe('fresh-from-model')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/harness.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./harness` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/main/meta/__evals__/harness.ts`:

```ts
// src/main/meta/__evals__/harness.ts
//
// Replay-by-default eval harness. In replay mode (the default, and what `npm test`
// runs) models/fetches are served from committed fixtures — offline, deterministic.
// EVAL_LIVE=1 hits real services; EVAL_RECORD=1 hits real services AND rewrites the
// fixture. Kept free of vitest imports so it can be used outside test files.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { MetaModel } from '../distill'

const HERE = dirname(fileURLToPath(import.meta.url))

export type EvalMode = 'replay' | 'live' | 'record'

export function evalMode(): EvalMode {
  if (process.env.EVAL_RECORD === '1') return 'record'
  if (process.env.EVAL_LIVE === '1') return 'live'
  return 'replay'
}

export function fixturePath(group: string, id: string, ext: string): string {
  return join(HERE, group, 'fixtures', `${id}.${ext}`)
}

export function loadFixture(group: string, id: string, ext: string): string | null {
  const p = fixturePath(group, id, ext)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

export function saveFixture(group: string, id: string, ext: string, data: string): void {
  const p = fixturePath(group, id, ext)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
}

/** A MetaModel backed by a fixture: replays in replay mode; calls `live` (and records
 *  in record mode) otherwise. Throws a clear, actionable error on a missing fixture. */
export function fixtureModel(group: string, id: string, live?: MetaModel): MetaModel {
  return async (prompt: string) => {
    const mode = evalMode()
    if (mode === 'replay') {
      const fix = loadFixture(group, id, 'txt')
      if (fix == null)
        throw new Error(`[eval] missing fixture for "${group}/${id}". Run: npm run eval:record`)
      return fix
    }
    if (!live) throw new Error(`[eval] ${mode} mode needs a live model for "${group}/${id}"`)
    const out = await live(prompt)
    if (mode === 'record') saveFixture(group, id, 'txt', out)
    return out
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/harness.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Add npm scripts**

In `package.json`, add to `"scripts"` (after `"test"`):

```json
    "eval": "EVAL_LIVE=1 vitest run src/main/meta/*.eval.test.ts",
    "eval:record": "EVAL_RECORD=1 vitest run src/main/meta/*.eval.test.ts",
```

(Bash-style env prefix. Windows contributors run `set EVAL_LIVE=1 && vitest ...` or add `cross-env` later — out of scope for this cut.)

- [ ] **Step 6: Commit**

```bash
git add src/main/meta/__evals__/harness.ts src/main/meta/__evals__/harness.test.ts package.json
git commit -m "feat(evals): replay-by-default eval harness + npm scripts"
```

---

### Task 2: Live model wired to app config

**Files:**
- Create: `src/main/meta/__evals__/liveModel.ts`
- Test: `src/main/meta/__evals__/liveModel.test.ts`

**Interfaces:**
- Consumes: `runClaudeOnce(prompt, cfg: { oauthToken: string | null; model: string })` from `src/main/meta/model.ts`; `MetaModel` from `../distill`.
- Produces:
  - `interface LiveConfig { provider: string; model: string; oauthToken: string | null }`
  - `resolveLiveConfig(env?: NodeJS.ProcessEnv): LiveConfig`
  - `liveModel(): MetaModel`

- [ ] **Step 1: Write the failing test**

Create `src/main/meta/__evals__/liveModel.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLiveConfig, liveModel } from './liveModel'

const SETTINGS = join(tmpdir(), 'axivale-eval-settings.json')

afterEach(() => {
  if (existsSync(SETTINGS)) rmSync(SETTINGS)
  delete process.env.AXIVALE_SETTINGS
  delete process.env.EVAL_PROVIDER
  delete process.env.EVAL_MODEL
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
})

describe('resolveLiveConfig', () => {
  it('reads provider/model from app settings.json', () => {
    writeFileSync(SETTINGS, JSON.stringify({ settings: { provider: 'claude', claudeModel: 'claude-opus-4-8' } }))
    process.env.AXIVALE_SETTINGS = SETTINGS
    const cfg = resolveLiveConfig()
    expect(cfg.provider).toBe('claude')
    expect(cfg.model).toBe('claude-opus-4-8')
  })

  it('defaults to claude + sonnet when settings are absent', () => {
    process.env.AXIVALE_SETTINGS = join(tmpdir(), 'does-not-exist.json')
    const cfg = resolveLiveConfig()
    expect(cfg.provider).toBe('claude')
    expect(cfg.model).toBe('claude-sonnet-4-6')
  })

  it('env vars override settings; token comes from env', () => {
    writeFileSync(SETTINGS, JSON.stringify({ settings: { provider: 'claude', claudeModel: 'claude-sonnet-4-6' } }))
    process.env.AXIVALE_SETTINGS = SETTINGS
    process.env.EVAL_MODEL = 'claude-haiku-4-5-20251001'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-123'
    const cfg = resolveLiveConfig()
    expect(cfg.model).toBe('claude-haiku-4-5-20251001')
    expect(cfg.oauthToken).toBe('tok-123')
  })
})

describe('liveModel', () => {
  it('throws for an unimplemented provider', () => {
    process.env.EVAL_PROVIDER = 'gemini'
    expect(() => liveModel()).toThrow(/only implements 'claude'/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/liveModel.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./liveModel`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/meta/__evals__/liveModel.ts`:

```ts
// src/main/meta/__evals__/liveModel.ts
//
// The live/record-mode model, wired to the SAME source of truth the app uses:
// provider + model come from the app's settings.json (env-overridable). The OAuth
// token is encrypted by Electron safeStorage and unreadable from a headless test
// process, so it falls back to CLAUDE_CODE_OAUTH_TOKEN. Mirrors the meta refresher,
// which pins claude-sonnet-4-6 (faithful spec-name copying) — same default here.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runClaudeOnce } from '../model'
import type { MetaModel } from '../distill'

function settingsPath(env: NodeJS.ProcessEnv): string {
  // Electron app.getName() === package "name" ('axivale') → userData ~/.config/axivale.
  return env.AXIVALE_SETTINGS ?? join(homedir(), '.config', 'axivale', 'settings.json')
}

function appSettings(env: NodeJS.ProcessEnv): Record<string, string> {
  const p = settingsPath(env)
  if (!existsSync(p)) return {}
  try {
    return ((JSON.parse(readFileSync(p, 'utf8')) as { settings?: Record<string, string> }).settings) ?? {}
  } catch {
    return {}
  }
}

export interface LiveConfig {
  provider: string
  model: string
  oauthToken: string | null
}

export function resolveLiveConfig(env: NodeJS.ProcessEnv = process.env): LiveConfig {
  const s = appSettings(env)
  return {
    provider: env.EVAL_PROVIDER ?? s.provider ?? 'claude',
    model: env.EVAL_MODEL ?? s.claudeModel ?? 'claude-sonnet-4-6',
    oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN ?? null
  }
}

export function liveModel(): MetaModel {
  const cfg = resolveLiveConfig()
  if (cfg.provider !== 'claude')
    throw new Error(`[eval] live model only implements 'claude' (got '${cfg.provider}')`)
  return (prompt: string) => runClaudeOnce(prompt, { oauthToken: cfg.oauthToken, model: cfg.model })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/liveModel.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

> Note: the `claudeModel` settings key is a best-effort default. If the app stores the Claude model under a different key, `EVAL_MODEL` overrides it; the meta refresher pins `claude-sonnet-4-6` regardless, so the default already matches production.

- [ ] **Step 5: Commit**

```bash
git add src/main/meta/__evals__/liveModel.ts src/main/meta/__evals__/liveModel.test.ts
git commit -m "feat(evals): live model resolver wired to app config"
```

---

### Task 3: Source-labeling eval (#1)

**Files:**
- Create: `src/main/meta/__evals__/grade.ts`
- Create: `src/main/meta/__evals__/source-labeling/cases.ts`
- Create: `src/main/meta/__evals__/source-labeling/fixtures/gw2mists-dps-warrior.txt`
- Create: `src/main/meta/sourceLabeling.eval.test.ts`

**Interfaces:**
- Consumes: `distill(modeName, excerpts, model, specMap?, today?)` and `SourceExcerpt` from `../distill`; `fixtureModel`, `evalMode` from `../__evals__/harness`; `liveModel` from `../__evals__/liveModel`.
- Produces:
  - `grade.ts`: `domainsIn(text: string): string[]`; `interface SourceExpect { include?: RegExp[]; exclude?: RegExp[]; domains?: string[] }`; `gradeSource(output: string, exp: SourceExpect): void`
  - `cases.ts`: `interface SourceCase { id: string; mode: string; excerpts: SourceExcerpt[]; specMap?: Record<string,string>; today?: string; expect: SourceExpect }`; `sourceCases: SourceCase[]`

- [ ] **Step 1: Write the failing test for grading helpers**

Create `src/main/meta/__evals__/grade.ts` test first — append to a new `grade.test.ts`:

Create `src/main/meta/__evals__/grade.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { domainsIn, gradeSource } from './grade'

describe('domainsIn', () => {
  it('extracts hostnames and strips www', () => {
    expect(domainsIn('see https://www.gw2mists.com/en/builds/x and http://snowcrows.com/y')).toEqual([
      'gw2mists.com',
      'snowcrows.com'
    ])
  })
})

describe('gradeSource', () => {
  it('passes when includes match and excludes are absent', () => {
    expect(() =>
      gradeSource('DPS Warrior — Berserker (gw2mists)', { include: [/Berserker/], exclude: [/snowcrows/i] })
    ).not.toThrow()
  })

  it('throws when an excluded pattern appears', () => {
    expect(() => gradeSource('wrong source: snowcrows', { exclude: [/snowcrows/i] })).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/grade.test.ts --maxWorkers=2`
Expected: FAIL — cannot resolve `./grade`.

- [ ] **Step 3: Implement grade.ts**

Create `src/main/meta/__evals__/grade.ts`:

```ts
// src/main/meta/__evals__/grade.ts
//
// Assertion-based grading helpers (no LLM judge). Imports vitest's expect so failures
// read as ordinary test failures with the offending output in the message.
import { expect } from 'vitest'

export function domainsIn(text: string): string[] {
  const re = /https?:\/\/([^/\s)]+)/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/^www\./, ''))
  return out
}

export interface SourceExpect {
  include?: RegExp[]
  exclude?: RegExp[]
  domains?: string[]
}

export function gradeSource(output: string, exp: SourceExpect): void {
  for (const re of exp.include ?? []) expect(output, `expected to match ${re}`).toMatch(re)
  for (const re of exp.exclude ?? []) expect(output, `expected NOT to match ${re}`).not.toMatch(re)
  if (exp.domains) {
    const found = domainsIn(output)
    for (const want of exp.domains) expect(found, `expected domain ${want} in ${found.join(', ')}`).toContain(want)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/grade.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the case definitions**

Create `src/main/meta/__evals__/source-labeling/cases.ts`:

```ts
// Seed source-labeling cases. The first guards the TODO.md regression: a gw2mists
// "DPS Warrior" build must be attributed to gw2mists with Berserker gear, and must
// NOT be cross-labeled to another site.
import type { SourceExcerpt } from '../../distill'
import type { SourceExpect } from '../grade'

export interface SourceCase {
  id: string
  mode: string
  excerpts: SourceExcerpt[]
  specMap?: Record<string, string>
  today?: string
  expect: SourceExpect
}

export const sourceCases: SourceCase[] = [
  {
    id: 'gw2mists-dps-warrior',
    mode: 'wvw',
    excerpts: [
      {
        source: 'gw2mists — "DPS Warrior"',
        text:
          'DPS Warrior. Focus: pressure & burst damage in coordinated fights. ' +
          "Style: melee range, power DPS. Gear: Berserker's armor. " +
          'URL: https://gw2mists.com/en/builds/warrior/dps-warrior'
      }
    ],
    expect: {
      include: [/Berserker/i, /gw2mists/i],
      exclude: [/snowcrows/i, /metabattle/i],
      domains: ['gw2mists.com']
    }
  }
]
```

- [ ] **Step 6: Write the eval test**

Create `src/main/meta/sourceLabeling.eval.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { distill } from './distill'
import { sourceCases } from './__evals__/source-labeling/cases'
import { fixtureModel, evalMode } from './__evals__/harness'
import { liveModel } from './__evals__/liveModel'
import { gradeSource } from './__evals__/grade'

describe('source-labeling eval', () => {
  // Only construct the live model outside replay (it reads app config / requires a token).
  const live = evalMode() === 'replay' ? undefined : liveModel()

  for (const c of sourceCases) {
    it(c.id, async () => {
      const model = fixtureModel('source-labeling', c.id, live)
      const out = await distill(c.mode, c.excerpts, model, c.specMap ?? {}, c.today ?? '')
      expect(out, 'distill returned null').toBeTruthy()
      gradeSource(out as string, c.expect)
    })
  }
})
```

- [ ] **Step 7: Seed the fixture**

Create `src/main/meta/__evals__/source-labeling/fixtures/gw2mists-dps-warrior.txt` with a representative distilled output that the assertions grade (this is a recorded-style fixture; `npm run eval:record` would regenerate it from the live model):

```
### WvW — Current Meta

- **DPS Warrior** (Berserker) — power burst for coordinated melee pushes.
  Notes: single-source: gw2mists. Berserker's gear; melee power DPS.
  Source: https://gw2mists.com/en/builds/warrior/dps-warrior
```

- [ ] **Step 8: Run the eval in replay mode**

Run: `npx vitest run src/main/meta/sourceLabeling.eval.test.ts --maxWorkers=2`
Expected: PASS (1 test) — uses the fixture, no network.

- [ ] **Step 9: Commit**

```bash
git add src/main/meta/__evals__/grade.ts src/main/meta/__evals__/grade.test.ts \
  src/main/meta/__evals__/source-labeling/ src/main/meta/sourceLabeling.eval.test.ts
git commit -m "feat(evals): source-labeling eval + grading helpers"
```

---

### Task 4: Gear-extraction eval (#3)

**Files:**
- Modify: `src/main/meta/__evals__/harness.ts` (add `fixtureFetch`)
- Modify: `src/main/meta/__evals__/harness.test.ts` (add a `fixtureFetch` test)
- Create: `src/main/meta/__evals__/gear/cases.ts`
- Create: `src/main/meta/__evals__/gear/fixtures/mb-minstrel-guardian.html`
- Create: `src/main/meta/__evals__/gear/fixtures/mb-minstrel-guardian.json`
- Create: `src/main/meta/gearExtraction.eval.test.ts`

**Interfaces:**
- Consumes: `scrapeBuildGear(html, profession, fetchImpl)` and `BuildGear` from `../buildGear`; `FetchLike` from `../snowcrows`; `loadFixture`, `evalMode` from harness.
- Produces:
  - `fixtureFetch(group: string, id: string, live?: FetchLike): FetchLike` (added to `harness.ts`)
  - `gear/cases.ts`: `interface GearCase { id: string; profession: string; expect: { stats?: RegExp; runeCount?: number; runeName?: RegExp; weapons?: number; sigils?: number; infusions?: number } }`; `gearCases: GearCase[]`

- [ ] **Step 1: Write the failing test for fixtureFetch**

Append to `src/main/meta/__evals__/harness.test.ts`:

```ts
import { fixtureFetch } from './harness'

describe('fixtureFetch', () => {
  it('replays GW2 item/itemstats responses keyed by ids= param', async () => {
    saveFixture('__selftest__', 'fetch-a', 'json', JSON.stringify({
      items: { '10': { name: 'Test Sword', icon: null, type: 'Weapon', details: { type: 'Sword' } } },
      itemstats: { '99': { name: "Minstrel's" } }
    }))
    const f = fixtureFetch('__selftest__', 'fetch-a')
    const items = await (await f('https://api.guildwars2.com/v2/items?ids=10&lang=en')).json()
    expect(items).toEqual([{ id: 10, name: 'Test Sword', icon: null, type: 'Weapon', details: { type: 'Sword' } }])
    const stats = await (await f('https://api.guildwars2.com/v2/itemstats?ids=99&lang=en')).json()
    expect(stats).toEqual([{ id: 99, name: "Minstrel's" }])
  })
})
```

Add cleanup for the new fixture in the existing `afterEach` of `harness.test.ts`:

```ts
  const fp = fixturePath('__selftest__', 'fetch-a', 'json')
  if (existsSync(fp)) rmSync(fp)
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/meta/__evals__/harness.test.ts --maxWorkers=2`
Expected: FAIL — `fixtureFetch` is not exported.

- [ ] **Step 3: Implement fixtureFetch in harness.ts**

Add to `src/main/meta/__evals__/harness.ts` (with a `FetchLike` import at the top):

```ts
import type { FetchLike } from '../snowcrows'

interface GearFixture {
  items: Record<string, { name: string; icon: string | null; type: string; details?: { type?: string } }>
  itemstats: Record<string, { name: string }>
}

const idsParam = (url: string): number[] =>
  (/[?&]ids=([^&]+)/.exec(url)?.[1] ?? '')
    .split(',')
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n))

const jsonResponse = (data: unknown) => ({
  ok: true,
  json: async () => data,
  text: async () => JSON.stringify(data)
})

/** A FetchLike that serves GW2 /v2/items and /v2/itemstats from a committed fixture,
 *  selecting entries by the request's ids= param. Replay-only by default; EVAL_LIVE
 *  passes through to the real (public, no-auth) GW2 API. */
export function fixtureFetch(group: string, id: string, live?: FetchLike): FetchLike {
  return async (url: string) => {
    if (evalMode() !== 'replay') {
      if (!live) throw new Error(`[eval] live/record fetch needs a real FetchLike for "${group}/${id}"`)
      return live(url)
    }
    const raw = loadFixture(group, id, 'json')
    if (raw == null)
      throw new Error(`[eval] missing fetch fixture "${group}/${id}". Hand-author <id>.json.`)
    const fix = JSON.parse(raw) as GearFixture
    const ids = idsParam(url)
    if (url.includes('/v2/itemstats'))
      return jsonResponse(ids.map((i) => ({ id: i, ...(fix.itemstats[String(i)] ?? { name: `stat-${i}` }) })))
    if (url.includes('/v2/items'))
      return jsonResponse(
        ids.map((i) => ({ id: i, ...(fix.items[String(i)] ?? { name: `item-${i}`, icon: null, type: 'Unknown' }) }))
      )
    return jsonResponse([])
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/meta/__evals__/harness.test.ts --maxWorkers=2`
Expected: PASS (all harness tests, including the new `fixtureFetch` one).

- [ ] **Step 5: Create the gear HTML fixture**

Create `src/main/meta/__evals__/gear/fixtures/mb-minstrel-guardian.html` (a faithful MetaBattle Equipment slice — one Staff set, one Mace/Shield set, rune x6, infusion, relic):

```html
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="72698" data-armory-72698-stat="1134" class="equipment-slot-asc"></div><small>Head<br />Minstrel</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="75200" data-armory-75200-stat="1134" class="equipment-slot-asc"></div><small>Staff<br />Minstrel</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="72339" class="equipment-slot-asc"></div><small>Sigil</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="24584" class="equipment-slot-asc"></div><small>Sigil</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="71457" data-armory-71457-stat="1134" class="equipment-slot-asc"></div><small>Mace<br />Minstrel</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="74748" data-armory-74748-stat="1134" class="equipment-slot-asc"></div><small>Shield<br />Minstrel</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="24607" class="equipment-slot-asc"></div><small>Sigil</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="24839" class="equipment-slot-asc"></div><small>Rune<br />x6</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="86986" class="equipment-slot-asc"></div><small>Infusion<br />x18</small></div>
<div class="equipment-slot"><div data-armory-embed="items" data-armory-ids="101116" class="equipment-slot-asc"></div><small>Relic</small></div>
```

- [ ] **Step 6: Create the gear API fixture**

Create `src/main/meta/__evals__/gear/fixtures/mb-minstrel-guardian.json` (resolves every id in the HTML; values are internally consistent with the assertions — `eval` live mode validates against the real API):

```json
{
  "items": {
    "72698": { "name": "Minstrel's Wreath", "icon": null, "type": "Armor", "details": { "type": "Helm" } },
    "75200": { "name": "Minstrel's Staff", "icon": null, "type": "Weapon", "details": { "type": "Staff" } },
    "72339": { "name": "Superior Sigil of Transference", "icon": null, "type": "UpgradeComponent", "details": { "type": "Sigil" } },
    "24584": { "name": "Superior Sigil of Concentration", "icon": null, "type": "UpgradeComponent", "details": { "type": "Sigil" } },
    "71457": { "name": "Minstrel's Mace", "icon": null, "type": "Weapon", "details": { "type": "Mace" } },
    "74748": { "name": "Minstrel's Shield", "icon": null, "type": "Weapon", "details": { "type": "Shield" } },
    "24607": { "name": "Superior Sigil of Energy", "icon": null, "type": "UpgradeComponent", "details": { "type": "Sigil" } },
    "24839": { "name": "Superior Rune of the Monk", "icon": null, "type": "UpgradeComponent", "details": { "type": "Rune" } },
    "86986": { "name": "Mighty +9 Agony Infusion", "icon": null, "type": "UpgradeComponent", "details": { "type": "Infusion" } },
    "101116": { "name": "Relic of the Defender", "icon": null, "type": "Relic", "details": { "type": "Relic" } }
  },
  "itemstats": {
    "1134": { "name": "Minstrel's" }
  }
}
```

- [ ] **Step 7: Create the gear cases**

Create `src/main/meta/__evals__/gear/cases.ts`:

```ts
// Gear-extraction cases. Profession is '' so no profession/skills API calls are made
// (resolveWeaponSkills returns [] for an empty profession) — keeps the fixture small.
export interface GearCase {
  id: string
  profession: string
  expect: {
    stats?: RegExp
    runeCount?: number
    runeName?: RegExp
    weapons?: number
    sigils?: number
    infusions?: number
  }
}

export const gearCases: GearCase[] = [
  {
    id: 'mb-minstrel-guardian',
    profession: '',
    expect: {
      stats: /Minstrel/,
      runeCount: 6,
      runeName: /Rune/,
      weapons: 3, // Staff + Mace + Shield
      sigils: 3,
      infusions: 1
    }
  }
]
```

- [ ] **Step 8: Write the gear eval test**

Create `src/main/meta/gearExtraction.eval.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scrapeBuildGear } from './buildGear'
import { gearCases } from './__evals__/gear/cases'
import { fixtureFetch, loadFixture, evalMode } from './__evals__/harness'
import type { FetchLike } from './snowcrows'

// Live/record mode validates against the real, public, no-auth GW2 API.
const realFetch: FetchLike = (url) => fetch(url, { headers: { 'User-Agent': 'AxiVale-eval' } })

describe('gear-extraction eval', () => {
  for (const c of gearCases) {
    it(c.id, async () => {
      const html = loadFixture('gear', c.id, 'html')
      expect(html, `missing HTML fixture for ${c.id}`).toBeTruthy()
      const f = fixtureFetch('gear', c.id, evalMode() === 'replay' ? undefined : realFetch)
      const gear = await scrapeBuildGear(html as string, c.profession, f)

      expect(gear, 'scrapeBuildGear returned null (empty gear regression)').toBeTruthy()
      if (!gear) return
      if (c.expect.stats) expect(gear.stats ?? '').toMatch(c.expect.stats)
      if (c.expect.runeCount != null) expect(gear.rune?.count).toBe(c.expect.runeCount)
      if (c.expect.runeName) expect(gear.rune?.name ?? '').toMatch(c.expect.runeName)
      if (c.expect.weapons != null) expect(gear.weapons.length).toBe(c.expect.weapons)
      if (c.expect.sigils != null) expect(gear.sigils.length).toBe(c.expect.sigils)
      if (c.expect.infusions != null) expect(gear.infusions.length).toBe(c.expect.infusions)
    })
  }
})
```

- [ ] **Step 9: Run the gear eval in replay mode**

Run: `npx vitest run src/main/meta/gearExtraction.eval.test.ts --maxWorkers=2`
Expected: PASS (1 test) — offline, using the two fixtures.

- [ ] **Step 10: Commit**

```bash
git add src/main/meta/__evals__/harness.ts src/main/meta/__evals__/harness.test.ts \
  src/main/meta/__evals__/gear/ src/main/meta/gearExtraction.eval.test.ts
git commit -m "feat(evals): gear-extraction eval + fixtureFetch"
```

---

### Task 5: Expand the comp-structure eval (#4)

**Files:**
- Modify: `src/main/meta/compCheck.eval.test.ts`

**Interfaces:**
- Consumes: `checkComp(roster): CompReport`, `Roster` from `./compCheck` (already imported in the file). No new exports.

- [ ] **Step 1: Add boundary cases (write the new failing-then-passing tests)**

Append these cases inside the existing `describe('WvW comp eval set', ...)` block in `src/main/meta/compCheck.eval.test.ts`, after the current `it('rejects an oversized subgroup', ...)`:

```ts
  // GOOD: exactly five with a flex/utility slot present alongside support + strip.
  it('accepts an exactly-five subgroup with a flex slot', () => {
    const good: Roster = {
      subgroups: [sg(['Primary Support', 'Secondary Support', 'Boon Strip DPS', 'Pure DPS', 'Flex'])]
    }
    expect(hasError(good)).toBe(false)
  })

  // BAD: support present but no boon strip anywhere in the squad.
  it('rejects a squad with no boon strip', () => {
    const bad: Roster = {
      subgroups: [
        sg(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS']),
        sg(['Primary Support', 'Secondary Support', 'Pure DPS', 'Pure DPS', 'Pure DPS'])
      ]
    }
    expect(hasError(bad)).toBe(true)
  })

  // BAD: no cleanse-capable support in a subgroup (all DPS + a lone strip).
  it('rejects a subgroup with no cleanse support', () => {
    const bad: Roster = {
      subgroups: [sg(['Boon Strip DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS', 'Pure DPS'])]
    }
    expect(hasError(bad)).toBe(true)
  })
```

- [ ] **Step 2: Run the comp eval**

Run: `npx vitest run src/main/meta/compCheck.eval.test.ts --maxWorkers=2`
Expected: PASS for all cases. If any of the three new cases does NOT match `checkComp`'s actual rules, read `src/main/meta/compCheck.ts`'s `checkComp` to confirm the real role labels/thresholds, then adjust that case's roles or expectation to reflect the real rule (the eval documents real behavior — do not change production logic to fit a guessed case).

- [ ] **Step 3: Commit**

```bash
git add src/main/meta/compCheck.eval.test.ts
git commit -m "test(evals): expand comp-structure boundary cases"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite (replay mode)**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS — all pre-existing tests plus the new eval/harness tests. Confirms the eval tests are CI-safe (no network, no token) by default.

- [ ] **Step 2: Smoke-check live wiring is reachable (optional, needs a token)**

Only if a `CLAUDE_CODE_OAUTH_TOKEN` is available:

Run: `CLAUDE_CODE_OAUTH_TOKEN=<token> npm run eval`
Expected: source-labeling and gear evals run against real services and pass (or surface genuine model drift, which is the point). Skip if no token — not required for completion.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "test(evals): full-suite green in replay mode"
```

---

## Self-Review

**Spec coverage:**
- Philosophy / replay-default / no new framework → Task 1 (harness, modes, scripts). ✓
- Assertion-based grading, no judge → Task 3 (`grade.ts`). ✓
- #1 source labeling via injected `MetaModel` → Tasks 2 (live) + 3 (eval). ✓
- #3 gear via `scrapeBuildGear`/captured fixtures → Task 4. ✓
- #4 comp structure extend existing → Task 5. ✓
- Live wired to app config, secret via env → Task 2. ✓
- `npm test` replay / `npm run eval` / `eval:record` → Task 1 scripts + Task 6 verification. ✓
- Harness self-tested → Tasks 1, 2, 3 (`harness.test.ts`, `liveModel.test.ts`, `grade.test.ts`). ✓
- Risks (fixture staleness, record refresh, Claude-only live) → reflected in Task 2 note, Task 4 (live passthrough), and gear-fixture comments. ✓

**Placeholder scan:** No TBD/TODO; every code/step shows complete content. Task 5 Step 2 intentionally instructs reading `checkComp` to reconcile a *test expectation* with real behavior — that is verification guidance, not a code placeholder.

**Type consistency:** `MetaModel`, `SourceExcerpt`, `FetchLike`, `BuildGear` used per their real signatures (`distill(modeName, excerpts, model, specMap?, today?)`, `scrapeBuildGear(html, profession, fetchImpl)`). `fixtureModel`/`fixtureFetch`/`gradeSource`/`resolveLiveConfig` signatures match between definition and use. `SourceExpect` defined in `grade.ts`, imported by `cases.ts`. ✓
