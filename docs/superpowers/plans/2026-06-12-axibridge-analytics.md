# AxiBridge Analytics Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users link the GitHub repos that hold their AxiBridge reports, then ask AxiVale analytics questions over run data (single run or seasons): improvement, attendance, commander performance — with charts/tables rendered inline. Raw EI report JSON (4–37 MB) never enters model context; a shared `@axiapps/bridge-metrics` package aggregates it down to compact JSON.

**Working directories:** /var/home/mstephens/Documents/GitHub/axibridge (bridge-metrics package + headless), /var/home/mstephens/Documents/GitHub/axivale (client, cache, tools, settings)

**Architecture:**
- **axibridge repo** gains a workspace package `packages/bridge-metrics` (`@axiapps/bridge-metrics`) holding the extracted aggregation core: `computePlayerAggregation`, the rollup builder (`buildRollupData` & friends from `src/web/rollup.ts`), the metric extractors (`dashboardMetrics`, `combatMetrics`, `conditionsMetrics`), and a new report-level module (`reportMetrics.ts`) that summarizes *published* `report.json` payloads. AxiBridge's in-tree files become re-export shims so exactly one copy exists. AxiBridge also gains `--headless`.
- **axivale repo** gains: a `github` keyring service + linked-repos setting; `src/main/axibridgeClient.ts` (raw.githubusercontent fetch with PAT header, Pages fallback); `src/main/axibridgeCache.ts` (immutable-forever reports, ~5 min TTL index/rollup, 2 GB LRU cap, streaming downloads with progress); a worker-thread summarizer caching per-run extracted summaries; `src/main/axibridgeService.ts` orchestration; `src/main/tools/axibridge.ts` with 8 read-only tools registered into `buildOfficerTools()`; an analytics-methodology system-prompt section; and a Settings UI section with repo health.
- **Display payloads:** tool handlers attach `display` as an extra property on the MCP `ToolResult` (the existing `ToolResult` interface in `src/main/tools.ts` has an index signature, so this compiles today). Shapes come from the sibling rendering plan: chart = `{ kind: 'chart', data: { type: 'line'|'bar'|'area', title, xKey, series: [{ key, label, color? }], rows } }`, table = `{ kind: 'table', data: { title?, columns: [{ key, label }], rows } }`. If the rendering mechanism is not merged when this plan executes, the renderer simply ignores the extra property — tools still return compact JSON, and renderer wiring is the trailing Task 13.

**Tech Stack:** TypeScript, Electron, vitest (always `--maxWorkers=2`), zod (axivale tool schemas), node `worker_threads`, plain `fetch`/`https`. No new runtime deps beyond the workspace package.

---

## Task 1: `@axiapps/bridge-metrics` package scaffold + metric-extractor move (axibridge repo)

All steps in `/var/home/mstephens/Documents/GitHub/axibridge`.

**Files:**
- Create: `packages/bridge-metrics/package.json`, `packages/bridge-metrics/tsconfig.json`, `packages/bridge-metrics/vitest.config.ts`, `packages/bridge-metrics/src/index.ts`
- Modify: `package.json` (root — add `"workspaces"`)
- Move (git mv into `packages/bridge-metrics/src/`, flattening the dir): `src/shared/dpsReportTypes.ts`, `src/shared/metricsSettings.ts`, `src/shared/constants.ts`, `src/shared/boonGeneration.ts`, `src/shared/professionUtils.ts`, `src/shared/dashboardMetrics.ts`, `src/shared/combatMetrics.ts`, `src/shared/conditionsMetrics.ts`
- Create re-export shims at every old `src/shared/*.ts` path

### Steps

- [ ] Add workspaces to the root `package.json` (after the `"license"` line):

```json
    "workspaces": ["packages/*"],
```

- [ ] Create `packages/bridge-metrics/package.json`:

```json
{
    "name": "@axiapps/bridge-metrics",
    "version": "0.1.0",
    "private": true,
    "description": "AxiBridge report aggregation core: player aggregation, rollup builder, metric extractors",
    "license": "GPL-3.0-only",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": {
        ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
        "./*": { "types": "./dist/*.d.ts", "default": "./dist/*.js" }
    },
    "typesVersions": { "*": { "*": ["dist/*"] } },
    "scripts": {
        "build": "tsc -p tsconfig.json",
        "prepare": "tsc -p tsconfig.json",
        "test": "vitest run --maxWorkers=2"
    },
    "devDependencies": {
        "typescript": "^5.2.2",
        "vitest": "^4.0.17"
    }
}
```

The `prepare` script makes `npm install` at the repo root build `dist/` automatically, so AxiBridge's existing `tsc`/`vite` builds and AxiVale's `file:` install always see compiled output.

- [ ] Create `packages/bridge-metrics/tsconfig.json`:

```json
{
    "compilerOptions": {
        "target": "ES2021",
        "module": "commonjs",
        "moduleResolution": "node",
        "declaration": true,
        "outDir": "dist",
        "rootDir": "src",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true
    },
    "include": ["src"],
    "exclude": ["src/__tests__"]
}
```

- [ ] Create `packages/bridge-metrics/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/__tests__/**/*.test.ts'],
        pool: 'forks',
        poolOptions: { forks: { maxForks: 2, minForks: 1 } },
        maxWorkers: 2
    }
});
```

- [ ] Write the failing smoke test `packages/bridge-metrics/src/__tests__/extractors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getPlayerCleanses, getPlayerStrips } from '../dashboardMetrics';
import { computeDownContribution, computeSquadHealing } from '../combatMetrics';
import { normalizeConditionLabel, NON_DAMAGING_CONDITIONS } from '../conditionsMetrics';
import { PROFESSION_COLORS } from '../professionUtils';

describe('bridge-metrics extractors', () => {
    it('exposes the dashboard metric extractors', () => {
        const player: any = { support: [{ condiCleanse: 3, condiCleanseSelf: 1 }] };
        expect(getPlayerCleanses(player)).toBe(4);
        expect(typeof getPlayerStrips).toBe('function');
    });
    it('exposes the combat metric extractors', () => {
        expect(typeof computeDownContribution).toBe('function');
        expect(typeof computeSquadHealing).toBe('function');
    });
    it('exposes condition helpers and profession colors', () => {
        expect(normalizeConditionLabel('Chilled')).toBe('Chilled');
        expect(NON_DAMAGING_CONDITIONS.size).toBeGreaterThan(0);
        expect(Object.keys(PROFESSION_COLORS).length).toBeGreaterThan(0);
    });
});
```

(Verify `getPlayerCleanses` semantics against `src/shared/dashboardMetrics.ts:11` when writing the test — if it reads different fields, assert on those instead.)

- [ ] Run, expect failure (modules not yet moved):
  `cd /var/home/mstephens/Documents/GitHub/axibridge && npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Move the shared modules (these eight files import only each other — verified):

```bash
cd /var/home/mstephens/Documents/GitHub/axibridge
mkdir -p packages/bridge-metrics/src
for f in dpsReportTypes metricsSettings constants boonGeneration professionUtils dashboardMetrics combatMetrics conditionsMetrics; do
    git mv src/shared/$f.ts packages/bridge-metrics/src/$f.ts
done
```

  Imports inside the moved files are all sibling-relative (`./dpsReportTypes`, `./metricsSettings`, `./boonGeneration`, `./constants`) so they keep working unchanged. If `src/shared/constants.ts` or `boonGeneration.ts` imports anything *outside* this set (check after the move with `grep -n "from '\.\./" packages/bridge-metrics/src/*.ts`), move that file too and shim it identically.

- [ ] Create the eight shims so every existing AxiBridge import keeps resolving (one copy of the logic — the package). Each shim is one line; e.g. `src/shared/dashboardMetrics.ts`:

```ts
export * from '@axiapps/bridge-metrics/dashboardMetrics';
```

  and identically for `dpsReportTypes`, `metricsSettings`, `constants`, `boonGeneration`, `professionUtils`, `combatMetrics`, `conditionsMetrics`.

- [ ] Create `packages/bridge-metrics/src/index.ts` (extended in Tasks 2–3):

```ts
export * from './dpsReportTypes';
export * from './metricsSettings';
export * from './dashboardMetrics';
export * from './combatMetrics';
export * from './conditionsMetrics';
export * from './professionUtils';
```

- [ ] `npm install` at the repo root (links the workspace, runs `prepare` → builds `dist/`).
- [ ] Re-run the package test, expect pass:
  `npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Verify AxiBridge itself still typechecks and its suite passes:
  `npm run typecheck && npx vitest run --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: extract shared metric extractors into @axiapps/bridge-metrics workspace package"`

---

## Task 2: move `computePlayerAggregation` + rollup builder into the package; trimmed fixtures (axibridge repo)

**Files:**
- Move: `src/renderer/stats/computePlayerAggregation.ts` → `packages/bridge-metrics/src/computePlayerAggregation.ts`; `src/web/rollup.ts` → `packages/bridge-metrics/src/rollup.ts`; `src/renderer/stats/statsMetrics.ts` → `packages/bridge-metrics/src/statsMetrics.ts`; `src/renderer/stats/utils/timestampUtils.ts` → `packages/bridge-metrics/src/timestampUtils.ts`
- Create: `packages/bridge-metrics/src/aggregationTypes.ts`, `packages/bridge-metrics/src/roles.ts`, `packages/bridge-metrics/src/resUtility.ts`, `scripts/make-trimmed-fixtures.mjs`, `test-fixtures/boon-trimmed/` (2 trimmed runs, committed)
- Modify (shims/imports): `src/renderer/stats/computePlayerAggregation.ts` (new shim), `src/web/rollup.ts` (new shim), `src/renderer/stats/statsMetrics.ts` (shim), `src/renderer/stats/utils/timestampUtils.ts` (shim), `src/renderer/stats/statsTypes.ts:43-55,105-113` (re-export moved types), `src/renderer/stats/classifyPlayerRoles.ts:3-20` (re-export moved interfaces), `src/renderer/stats/utils/dashboardUtils.ts:31-38` (re-export `isResUtilitySkill`)

### Steps

- [ ] Create `scripts/make-trimmed-fixtures.mjs` — reduced fixtures derived from `test-fixtures/boon/` (200 MB total — the full set stays git-only in axibridge; only the trimmed output is newly committed, target < 2 MB/file):

```js
// Generates small EI-log fixtures for fast aggregation tests.
// Usage: node scripts/make-trimmed-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'test-fixtures/boon';
const DEST = 'test-fixtures/boon-trimmed';
const KEEP = ['20260117-175120.json', '20260125-202439.json']; // the two smallest runs
const MAX_PLAYERS = 10;
const MAX_TARGETS = 5;

fs.mkdirSync(DEST, { recursive: true });
for (const name of KEEP) {
    const details = JSON.parse(fs.readFileSync(path.join(SRC, name), 'utf8'));
    details.players = (details.players || []).slice(0, MAX_PLAYERS).map((p) => {
        const { combatReplayData, ...rest } = p;
        return rest;
    });
    details.targets = (details.targets || []).slice(0, MAX_TARGETS).map((t) => {
        const { combatReplayData, ...rest } = t;
        return rest;
    });
    delete details.combatReplayMetaData;
    delete details.mechanics;
    fs.writeFileSync(path.join(DEST, name), JSON.stringify(details));
    const mb = fs.statSync(path.join(DEST, name)).size / 1024 / 1024;
    console.log(`${name}: ${mb.toFixed(2)} MB`);
}
```

- [ ] Run it, confirm both outputs are < 2 MB, and commit the two trimmed files:
  `node scripts/make-trimmed-fixtures.mjs`
- [ ] Write the failing test `packages/bridge-metrics/src/__tests__/computePlayerAggregation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computePlayerAggregation } from '../computePlayerAggregation';
import { buildRollupData } from '../rollup';

const FIXTURES = path.resolve(__dirname, '../../../../test-fixtures/boon-trimmed');
const loadLog = (name: string) => ({
    details: JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
});

describe('computePlayerAggregation', () => {
    it('aggregates player stats across two trimmed fixture logs', () => {
        const validLogs = ['20260117-175120.json', '20260125-202439.json'].map(loadLog);
        const result = computePlayerAggregation({
            validLogs,
            method: 'count',
            skillDamageSource: 'target',
            splitPlayersByClass: false
        });
        expect(result.playerStats.size).toBeGreaterThan(0);
        const anyPlayer = [...result.playerStats.values()][0];
        expect(anyPlayer.account.length).toBeGreaterThan(0);
        expect(anyPlayer.logsJoined).toBeGreaterThanOrEqual(1);
        expect(result.wins + result.losses).toBe(2);
        expect(result.totalSquadSizeAccum).toBeGreaterThan(0);
    });
});

describe('buildRollupData', () => {
    it('rolls up attendance + commander rows from report payloads', () => {
        const source = {
            meta: { id: 'r1', dateStart: '2026-01-17T17:51:20Z', dateEnd: '2026-01-17T19:00:00Z', generatedAt: '2026-01-17T19:05:00Z' },
            stats: {
                commanderStats: { rows: [{ account: 'Cmdr.1234', characterNames: ['Cmdr'], profession: 'Firebrand', fights: 7, kills: 40, downs: 55, commanderDeaths: 1, alliesDead: 12, wins: 5, losses: 2 }] },
                attendanceData: [{ account: 'Player.5678', characterNames: ['Alt'], combatTimeMs: 1_200_000, squadTimeMs: 3_600_000, classTimes: [{ profession: 'Scourge', timeMs: 1_200_000 }] }]
            }
        };
        const rollup = buildRollupData([source]);
        expect(rollup.commanderRows[0].account).toBe('Cmdr.1234');
        expect(rollup.commanderRows[0].fightsLed).toBe(7);
        expect(rollup.playerRows[0].account).toBe('Player.5678');
        expect(rollup.playerRows[0].profession).toBe('Scourge');
        expect(rollup.uniqueRaids).toBe(1);
    });
});
```

- [ ] Run, expect failure (modules missing):
  `npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Create the three small support modules the aggregation needs inside the package.
  `packages/bridge-metrics/src/aggregationTypes.ts` (moved verbatim from `src/renderer/stats/statsTypes.ts:43-53` and `:105-113`):

```ts
export interface PlayerSkillDamageEntry {
    id: string;
    name: string;
    icon?: string;
    damage: number;
    downContribution: number;
    hits: number;
    casts: number;
    min: number;
    max: number;
}

export interface PlayerHealingSkillEntry {
    id: string;
    name: string;
    icon?: string;
    total: number;
    hits: number;
    max: number;
}
```

  (Copy the interface bodies exactly from `statsTypes.ts` — the field lists above were verified against `computePlayerAggregation.ts:1054` and `:1104`; if `statsTypes.ts` has extra optional fields, keep them.)

  `packages/bridge-metrics/src/roles.ts`: move the `RoleClassificationFactor` (line 3) and `PlayerRoleClassification` (line 12) interface blocks **verbatim** out of `src/renderer/stats/classifyPlayerRoles.ts`; leave the `classifyPlayerRoles` function in the renderer and change its file to `import type { PlayerRoleClassification, RoleClassificationFactor } from '@axiapps/bridge-metrics/roles';` plus `export type { PlayerRoleClassification, RoleClassificationFactor };`.

  `packages/bridge-metrics/src/resUtility.ts`: move `isResUtilitySkill` **verbatim** from `src/renderer/stats/utils/dashboardUtils.ts:31`, importing `RES_UTILITY_NAME_MATCHES` and `RES_UTILITY_IDS` from `./statsMetrics`; in `dashboardUtils.ts` replace the function with `export { isResUtilitySkill } from '@axiapps/bridge-metrics/resUtility';`.

- [ ] Move the four main files:

```bash
git mv src/renderer/stats/computePlayerAggregation.ts packages/bridge-metrics/src/computePlayerAggregation.ts
git mv src/web/rollup.ts packages/bridge-metrics/src/rollup.ts
git mv src/renderer/stats/statsMetrics.ts packages/bridge-metrics/src/statsMetrics.ts
git mv src/renderer/stats/utils/timestampUtils.ts packages/bridge-metrics/src/timestampUtils.ts
```

- [ ] Fix imports inside the moved files:
  - `computePlayerAggregation.ts`: `../../shared/dashboardMetrics` → `./dashboardMetrics`; `../../shared/combatMetrics` → `./combatMetrics`; `../../shared/dpsReportTypes` → `./dpsReportTypes`; `../global.d` (`DisruptionMethod`) → `./metricsSettings`; `../../shared/conditionsMetrics` → `./conditionsMetrics`; `./statsMetrics` unchanged; `./utils/dashboardUtils` (`isResUtilitySkill`) → `./resUtility`; `./statsTypes` → `./aggregationTypes`; `../../shared/professionUtils` → `./professionUtils`; `./utils/timestampUtils` → `./timestampUtils`; `./classifyPlayerRoles` (`PlayerRoleClassification`) → `./roles`.
  - `statsMetrics.ts`: `../../shared/conditionsMetrics` → `./conditionsMetrics`.
  - `timestampUtils.ts`: fix any `../../shared/` imports to `./` siblings (it is pure date logic; if it imports nothing, no change).
  - `rollup.ts`: no imports (verified) — no change.
- [ ] Create the four shims:
  - `src/renderer/stats/computePlayerAggregation.ts`: `export * from '@axiapps/bridge-metrics/computePlayerAggregation';`
  - `src/web/rollup.ts`: `export * from '@axiapps/bridge-metrics/rollup';`
  - `src/renderer/stats/statsMetrics.ts`: `export * from '@axiapps/bridge-metrics/statsMetrics';`
  - `src/renderer/stats/utils/timestampUtils.ts`: `export * from '@axiapps/bridge-metrics/timestampUtils';`
  - In `src/renderer/stats/statsTypes.ts`, delete the `PlayerSkillDamageEntry`/`PlayerHealingSkillEntry` definitions and add `export type { PlayerSkillDamageEntry, PlayerHealingSkillEntry } from '@axiapps/bridge-metrics/aggregationTypes';` (keep its other exports untouched).
- [ ] Extend `packages/bridge-metrics/src/index.ts`:

```ts
export * from './computePlayerAggregation';
export * from './rollup';
export * from './aggregationTypes';
export * from './roles';
export { isResUtilitySkill } from './resUtility';
export { resolveFightTimestamp, parseTimestamp as parseFightTimestamp } from './timestampUtils';
```

  (`parseTimestamp` is aliased because `rollup.ts` has no export of that name but `timestampUtils` and any future module could collide; keep the barrel free of duplicate names. Do **not** `export * from './statsMetrics'` in the barrel — it re-exports `NON_DAMAGING_CONDITIONS`, which `conditionsMetrics` already exports; consumers needing `OFFENSE_METRICS` etc. import the subpath.)
- [ ] Rebuild and run the package tests, expect pass:
  `npm run build -w @axiapps/bridge-metrics && npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Verify AxiBridge still compiles and its unit suite passes (the shims keep every old import path alive):
  `npm run typecheck && npx vitest run --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: move computePlayerAggregation + rollup builder into @axiapps/bridge-metrics; trimmed fixtures"`

---

## Task 3: report-level aggregation (`reportMetrics.ts`) in bridge-metrics (axibridge repo)

Published `report.json` is `{ meta, stats }` where `stats` carries per-run player tables (`offensePlayers`, `supportPlayers`, `healingPlayers`, `defensePlayers`, `generalPlayers`, `attendanceData`, `commanderStats.rows`, plus `total/wins/losses/avgSquadSize/avgEnemies/totalSquadDeaths/...` — shapes verified against `src/renderer/stats/incrementalAggregation.ts:1339-1470` and `src/web/rollup.ts:40-53`). AxiVale aggregates over these, never over raw EI logs.

**Files:**
- Create: `packages/bridge-metrics/src/reportMetrics.ts`, `packages/bridge-metrics/src/__tests__/reportMetrics.test.ts`, `packages/bridge-metrics/src/__tests__/fixtures/report-small.ts`
- Modify: `packages/bridge-metrics/src/index.ts`

### Steps

- [ ] Create the shared test fixture `packages/bridge-metrics/src/__tests__/fixtures/report-small.ts` (synthetic, shaped exactly like a published report):

```ts
export const reportSmall = {
    meta: {
        id: '20260117-1751',
        title: 'Friday Reset',
        dateStart: '2026-01-17T17:51:20Z',
        dateEnd: '2026-01-17T19:00:00Z',
        generatedAt: '2026-01-17T19:05:00Z',
        commanders: ['Cmdr.1234']
    },
    stats: {
        total: 7,
        wins: 5,
        losses: 2,
        avgSquadSize: 28.4,
        avgEnemies: 31.2,
        totalSquadDeaths: 14,
        totalSquadDowns: 22,
        totalEnemyDeaths: 41,
        totalEnemyDowns: 58,
        offensePlayers: [
            { account: 'Player.5678', profession: 'Scourge', professionList: ['Scourge'], totalFightMs: 1_200_000, offenseTotals: { damage: 2_400_000, downContribution: 310_000, killed: 9, downed: 14, boonStrips: 120 }, offenseRateWeights: {} },
            { account: 'Cmdr.1234', profession: 'Firebrand', professionList: ['Firebrand'], totalFightMs: 1_200_000, offenseTotals: { damage: 600_000, downContribution: 40_000, killed: 2, downed: 4, boonStrips: 3 }, offenseRateWeights: {} }
        ],
        supportPlayers: [
            { account: 'Cmdr.1234', profession: 'Firebrand', professionList: ['Firebrand'], activeMs: 1_200_000, logsJoined: 7, supportTotals: { condiCleanse: 240, boonStrips: 3, resurrects: 6 } },
            { account: 'Player.5678', profession: 'Scourge', professionList: ['Scourge'], activeMs: 1_200_000, logsJoined: 7, supportTotals: { condiCleanse: 60, boonStrips: 120, resurrects: 1 } }
        ],
        healingPlayers: [
            { account: 'Cmdr.1234', profession: 'Firebrand', professionList: ['Firebrand'], activeMs: 1_200_000, hasHealAddon: true, healingTotals: { healing: 900_000, squadHealing: 850_000, barrier: 120_000 } }
        ],
        defensePlayers: [
            { account: 'Player.5678', profession: 'Scourge', professionList: ['Scourge'], activeMs: 1_200_000, logsJoined: 7, defenseTotals: { damageTaken: 800_000, downCount: 2, deadCount: 1 } },
            { account: 'Cmdr.1234', profession: 'Firebrand', professionList: ['Firebrand'], activeMs: 1_200_000, logsJoined: 7, defenseTotals: { damageTaken: 500_000, downCount: 1, deadCount: 0 } }
        ],
        generalPlayers: [
            { account: 'Player.5678', profession: 'Scourge', professionList: ['Scourge'], totalFightMs: 1_200_000, squadActiveMs: 1_150_000, logsJoined: 7, stackedLogCount: 6, totalDist: 1200, distCount: 7 },
            { account: 'Cmdr.1234', profession: 'Firebrand', professionList: ['Firebrand'], totalFightMs: 1_200_000, squadActiveMs: 1_200_000, logsJoined: 7, stackedLogCount: 7, totalDist: 0, distCount: 7 }
        ],
        attendanceData: [
            { account: 'Player.5678', characterNames: ['Alt'], combatTimeMs: 1_150_000, squadTimeMs: 3_600_000, classTimes: [{ profession: 'Scourge', timeMs: 1_150_000 }] },
            { account: 'Cmdr.1234', characterNames: ['Cmdr'], combatTimeMs: 1_200_000, squadTimeMs: 4_000_000, classTimes: [{ profession: 'Firebrand', timeMs: 1_200_000 }] }
        ],
        commanderStats: { rows: [{ account: 'Cmdr.1234', characterNames: ['Cmdr'], profession: 'Firebrand', fights: 7, kills: 41, downs: 58, commanderDeaths: 0, alliesDead: 14, wins: 5, losses: 2 }] }
    }
};
```

- [ ] Write the failing test `packages/bridge-metrics/src/__tests__/reportMetrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractRunSummary, aggregatePlayers, compareRunSets, ReportSchemaError } from '../reportMetrics';
import { reportSmall } from './fixtures/report-small';

describe('extractRunSummary', () => {
    it('projects a published report into a compact run summary', () => {
        const summary = extractRunSummary(reportSmall);
        expect(summary.id).toBe('20260117-1751');
        expect(summary.fights).toBe(7);
        expect(summary.wins).toBe(5);
        expect(summary.commanders).toEqual(['Cmdr.1234']);
        const scourge = summary.players.find((p) => p.account === 'Player.5678')!;
        expect(scourge.damage).toBe(2_400_000);
        expect(scourge.strips).toBe(120);
        expect(scourge.deaths).toBe(1);
        expect(scourge.squadTimeMs).toBe(3_600_000);
        const fb = summary.players.find((p) => p.account === 'Cmdr.1234')!;
        expect(fb.healing).toBe(850_000);
        expect(fb.hasHealAddon).toBe(true);
    });
    it('throws ReportSchemaError when meta.id is missing', () => {
        expect(() => extractRunSummary({ stats: {} })).toThrow(ReportSchemaError);
    });
    it('tolerates missing player tables (older schema)', () => {
        const summary = extractRunSummary({ meta: { id: 'old-1' }, stats: { total: 3, wins: 1, losses: 2 } });
        expect(summary.players).toEqual([]);
        expect(summary.warnings).toContain('no player tables in report');
    });
});

describe('aggregatePlayers', () => {
    it('merges per-run summaries into per-account aggregates', () => {
        const s = extractRunSummary(reportSmall);
        const rows = aggregatePlayers([s, { ...s, id: 'run-2' }]);
        const scourge = rows.find((r) => r.account === 'Player.5678')!;
        expect(scourge.runsJoined).toBe(2);
        expect(scourge.damage).toBe(4_800_000);
        expect(scourge.dps).toBeCloseTo(4_800_000 / (2 * 1_150_000 / 1000), 0);
        expect(scourge.professionTimeMs.Scourge).toBe(2_300_000);
    });
    it('filters to requested accounts', () => {
        const s = extractRunSummary(reportSmall);
        const rows = aggregatePlayers([s], ['Cmdr.1234']);
        expect(rows).toHaveLength(1);
        expect(rows[0].account).toBe('Cmdr.1234');
    });
});

describe('compareRunSets', () => {
    it('produces per-metric deltas between two run sets', () => {
        const s = extractRunSummary(reportSmall);
        const doubled = { ...s, id: 'run-2', squadDeaths: 28 };
        const result = compareRunSets([s], [doubled]);
        const deaths = result.metrics.find((m) => m.metric === 'squadDeaths')!;
        expect(deaths.a).toBe(14);
        expect(deaths.b).toBe(28);
        expect(deaths.delta).toBe(14);
    });
});
```

- [ ] Run, expect failure:
  `npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Create `packages/bridge-metrics/src/reportMetrics.ts`:

```ts
/**
 * Report-level aggregation over PUBLISHED report.json payloads ({ meta, stats }).
 * Defensive by design: published schemas vary across AxiBridge versions, so every
 * field read is optional and failures surface as warnings or ReportSchemaError —
 * never silent drops.
 */

export class ReportSchemaError extends Error {}

const num = (value: unknown): number => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
};

export interface RunPlayerSummary {
    account: string;
    profession: string;
    professionList: string[];
    combatTimeMs: number;
    squadTimeMs: number;
    classTimes: Array<{ profession: string; timeMs: number }>;
    damage: number;
    downContribution: number;
    kills: number;
    downsCaused: number;
    strips: number;
    cleanses: number;
    resurrects: number;
    healing: number;
    barrier: number;
    hasHealAddon: boolean;
    damageTaken: number;
    downs: number;
    deaths: number;
    logsJoined: number;
}

export interface RunSummary {
    id: string;
    title: string;
    dateStart: string | null;
    dateEnd: string | null;
    fights: number;
    wins: number;
    losses: number;
    avgSquadSize: number | null;
    avgEnemies: number | null;
    squadDeaths: number;
    squadDowns: number;
    enemyDeaths: number;
    enemyDowns: number;
    commanders: string[];
    players: RunPlayerSummary[];
    warnings: string[];
}

export const extractRunSummary = (report: unknown): RunSummary => {
    const payload = report as { meta?: any; stats?: any } | null;
    const id = String(payload?.meta?.id ?? '').trim();
    if (!id) throw new ReportSchemaError('report has no meta.id — not an AxiBridge report.json');
    const stats = payload?.stats ?? {};
    const warnings: string[] = [];

    const byAccount = new Map<string, RunPlayerSummary>();
    const ensure = (row: any): RunPlayerSummary | null => {
        const account = String(row?.account ?? '').trim();
        if (!account || account === 'Unknown') return null;
        let entry = byAccount.get(account);
        if (!entry) {
            entry = {
                account,
                profession: String(row?.profession ?? 'Unknown'),
                professionList: Array.isArray(row?.professionList) ? row.professionList.map(String) : [],
                combatTimeMs: 0, squadTimeMs: 0, classTimes: [],
                damage: 0, downContribution: 0, kills: 0, downsCaused: 0,
                strips: 0, cleanses: 0, resurrects: 0,
                healing: 0, barrier: 0, hasHealAddon: false,
                damageTaken: 0, downs: 0, deaths: 0, logsJoined: 0
            };
            byAccount.set(account, entry);
        }
        return entry;
    };

    const tables = ['offensePlayers', 'supportPlayers', 'healingPlayers', 'defensePlayers', 'generalPlayers', 'attendanceData'];
    if (!tables.some((key) => Array.isArray(stats?.[key]) && stats[key].length > 0)) {
        warnings.push('no player tables in report');
    }

    for (const row of Array.isArray(stats?.offensePlayers) ? stats.offensePlayers : []) {
        const p = ensure(row);
        if (!p) continue;
        p.damage += num(row?.offenseTotals?.damage);
        p.downContribution += num(row?.offenseTotals?.downContribution);
        p.kills += num(row?.offenseTotals?.killed);
        p.downsCaused += num(row?.offenseTotals?.downed);
        p.strips = Math.max(p.strips, num(row?.offenseTotals?.boonStrips));
    }
    for (const row of Array.isArray(stats?.supportPlayers) ? stats.supportPlayers : []) {
        const p = ensure(row);
        if (!p) continue;
        p.cleanses += num(row?.supportTotals?.condiCleanse);
        p.strips = Math.max(p.strips, num(row?.supportTotals?.boonStrips));
        p.resurrects += num(row?.supportTotals?.resurrects);
        p.logsJoined = Math.max(p.logsJoined, num(row?.logsJoined));
    }
    for (const row of Array.isArray(stats?.healingPlayers) ? stats.healingPlayers : []) {
        const p = ensure(row);
        if (!p) continue;
        p.healing += num(row?.healingTotals?.squadHealing ?? row?.healingTotals?.healing);
        p.barrier += num(row?.healingTotals?.squadBarrier ?? row?.healingTotals?.barrier);
        if (row?.hasHealAddon === true) p.hasHealAddon = true;
    }
    for (const row of Array.isArray(stats?.defensePlayers) ? stats.defensePlayers : []) {
        const p = ensure(row);
        if (!p) continue;
        p.damageTaken += num(row?.defenseTotals?.damageTaken);
        p.downs += num(row?.defenseTotals?.downCount);
        p.deaths += num(row?.defenseTotals?.deadCount);
    }
    for (const row of Array.isArray(stats?.generalPlayers) ? stats.generalPlayers : []) {
        const p = ensure(row);
        if (!p) continue;
        p.combatTimeMs = Math.max(p.combatTimeMs, num(row?.squadActiveMs ?? row?.totalFightMs));
        p.logsJoined = Math.max(p.logsJoined, num(row?.logsJoined));
    }
    for (const row of Array.isArray(stats?.attendanceData) ? stats.attendanceData : []) {
        const p = ensure(row);
        if (!p) continue;
        p.combatTimeMs = Math.max(p.combatTimeMs, num(row?.combatTimeMs));
        p.squadTimeMs = Math.max(p.squadTimeMs, num(row?.squadTimeMs));
        if (Array.isArray(row?.classTimes)) {
            p.classTimes = row.classTimes
                .map((c: any) => ({ profession: String(c?.profession ?? ''), timeMs: num(c?.timeMs) }))
                .filter((c: { profession: string; timeMs: number }) => c.profession && c.timeMs > 0);
        }
    }

    return {
        id,
        title: String(payload?.meta?.title ?? id),
        dateStart: payload?.meta?.dateStart ?? null,
        dateEnd: payload?.meta?.dateEnd ?? null,
        fights: num(stats?.total),
        wins: num(stats?.wins),
        losses: num(stats?.losses),
        avgSquadSize: typeof stats?.avgSquadSize === 'number' ? stats.avgSquadSize : null,
        avgEnemies: typeof stats?.avgEnemies === 'number' ? stats.avgEnemies : null,
        squadDeaths: num(stats?.totalSquadDeaths),
        squadDowns: num(stats?.totalSquadDowns),
        enemyDeaths: num(stats?.totalEnemyDeaths),
        enemyDowns: num(stats?.totalEnemyDowns),
        commanders: Array.isArray(payload?.meta?.commanders) ? payload.meta.commanders.map(String) : [],
        players: Array.from(byAccount.values()),
        warnings
    };
};

export interface PlayerAggregate {
    account: string;
    runsJoined: number;
    combatTimeMs: number;
    squadTimeMs: number;
    professionTimeMs: Record<string, number>;
    damage: number;
    dps: number;
    downContribution: number;
    kills: number;
    strips: number;
    cleanses: number;
    resurrects: number;
    healing: number;
    barrier: number;
    damageTaken: number;
    downs: number;
    deaths: number;
    lastSeen: string | null;
}

export const aggregatePlayers = (summaries: RunSummary[], accounts?: string[]): PlayerAggregate[] => {
    const wanted = accounts && accounts.length > 0
        ? new Set(accounts.map((a) => a.toLowerCase()))
        : null;
    const map = new Map<string, PlayerAggregate>();
    for (const run of summaries) {
        for (const p of run.players) {
            if (wanted && !wanted.has(p.account.toLowerCase())) continue;
            let agg = map.get(p.account);
            if (!agg) {
                agg = {
                    account: p.account, runsJoined: 0, combatTimeMs: 0, squadTimeMs: 0,
                    professionTimeMs: {}, damage: 0, dps: 0, downContribution: 0, kills: 0,
                    strips: 0, cleanses: 0, resurrects: 0, healing: 0, barrier: 0,
                    damageTaken: 0, downs: 0, deaths: 0, lastSeen: null
                };
                map.set(p.account, agg);
            }
            agg.runsJoined += 1;
            agg.combatTimeMs += p.combatTimeMs;
            agg.squadTimeMs += p.squadTimeMs;
            for (const c of p.classTimes) {
                agg.professionTimeMs[c.profession] = (agg.professionTimeMs[c.profession] || 0) + c.timeMs;
            }
            agg.damage += p.damage;
            agg.downContribution += p.downContribution;
            agg.kills += p.kills;
            agg.strips += p.strips;
            agg.cleanses += p.cleanses;
            agg.resurrects += p.resurrects;
            agg.healing += p.healing;
            agg.barrier += p.barrier;
            agg.damageTaken += p.damageTaken;
            agg.downs += p.downs;
            agg.deaths += p.deaths;
            const seen = run.dateEnd ?? run.dateStart;
            if (seen && (!agg.lastSeen || seen > agg.lastSeen)) agg.lastSeen = seen;
        }
    }
    const rows = Array.from(map.values());
    for (const row of rows) {
        row.dps = row.combatTimeMs > 0 ? row.damage / (row.combatTimeMs / 1000) : 0;
    }
    return rows.sort((a, b) => b.damage - a.damage);
};

const RUN_SET_METRICS = [
    'fights', 'wins', 'losses', 'squadDeaths', 'squadDowns', 'enemyDeaths', 'enemyDowns'
] as const;

export interface RunSetComparison {
    metrics: Array<{ metric: string; a: number; b: number; delta: number; deltaPct: number | null }>;
}

export const compareRunSets = (a: RunSummary[], b: RunSummary[]): RunSetComparison => {
    const total = (runs: RunSummary[], metric: (typeof RUN_SET_METRICS)[number]) =>
        runs.reduce((sum, run) => sum + num(run[metric]), 0);
    return {
        metrics: RUN_SET_METRICS.map((metric) => {
            const va = total(a, metric);
            const vb = total(b, metric);
            return { metric, a: va, b: vb, delta: vb - va, deltaPct: va !== 0 ? (vb - va) / va : null };
        })
    };
};
```

- [ ] Add to `packages/bridge-metrics/src/index.ts`:

```ts
export * from './reportMetrics';
```

- [ ] Rebuild + run, expect pass:
  `npm run build -w @axiapps/bridge-metrics && npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat(bridge-metrics): report-level run summaries, player aggregates, run-set comparison"`

---

## Task 4: AxiBridge `--headless` mode (axibridge repo)

**Files:**
- Create: `src/main/cliFlags.ts`, `src/main/__tests__/cliFlags.test.ts`
- Modify: `src/main/index.ts` (`createWindow()` at line 1134 — extract service init at lines 1190–1256; `whenReady` block at lines 1407–1418; `second-instance` handler at line 1398)

### Steps

- [ ] Write the failing test `src/main/__tests__/cliFlags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCliFlags } from '../cliFlags';

describe('parseCliFlags', () => {
    it('detects --headless anywhere in argv', () => {
        expect(parseCliFlags(['electron', '.', '--headless']).headless).toBe(true);
        expect(parseCliFlags(['/usr/bin/AxiBridge', '--headless', '--foo']).headless).toBe(true);
    });
    it('defaults to windowed', () => {
        expect(parseCliFlags(['electron', '.']).headless).toBe(false);
    });
});
```

- [ ] Run, expect failure: `npx vitest run src/main/__tests__/cliFlags.test.ts --maxWorkers=2`
- [ ] Create `src/main/cliFlags.ts`:

```ts
/** CLI flag parsing for the main process. Pure — testable without Electron. */
export interface CliFlags {
    headless: boolean;
}

export const parseCliFlags = (argv: string[]): CliFlags => ({
    headless: argv.includes('--headless')
});
```

- [ ] Run, expect pass: `npx vitest run src/main/__tests__/cliFlags.test.ts --maxWorkers=2`
- [ ] Refactor `src/main/index.ts`:
  1. Import at the top: `import { parseCliFlags } from './cliFlags';` and add `const cliFlags = parseCliFlags(process.argv);`.
  2. Extract the service initialization currently inside `createWindow()` (lines 1190–1256: `watcher = new LogWatcher()`, `uploader = new Uploader()`, `discord = new DiscordNotifier()`, `eiManager = new EiManager(...)` + EI settings, Discord webhook/embed/disruption config, dps.report token, and the `watcher.on('log-detected', ...)` hook) into a new module-level function:

```ts
let servicesInitialized = false;

function initServices() {
    if (servicesInitialized) return;
    servicesInitialized = true;
    // (moved verbatim from createWindow: watcher/uploader/discord/eiManager
    //  construction, settings application, and the log-detected handler)
}
```

  3. `createWindow()` calls `initServices()` where the moved block used to be. The EI auto-manage block (lines 1200–1232) stays driven by `win.webContents.on('did-finish-load', ...)` when a window exists; add a headless path that calls the same `runAutoManage` via `setTimeout(runAutoManage, 2000)` when `cliFlags.headless` (all renderer sends inside it are already `win?.`-optional-chained, so they no-op headless).
  4. In the `whenReady` block (line 1407) replace `createWindow();` with:

```ts
        if (cliFlags.headless) {
            log.info('[Main] Starting in headless mode — watcher/uploader/publisher only.');
            initServices();
        } else {
            createWindow();
        }
        createTray();
```

  The `axiom-version` file write at line 1408 stays first in `whenReady` — it runs in both modes (this is the axiom-convention version file the spec requires).
  5. Update the `second-instance` handler (line 1398) so a windowed launch attaches to a running headless instance:

```ts
    app.on('second-instance', (_event, commandLine, _workingDirectory) => {
        const secondWantsWindow = !parseCliFlags(commandLine).headless;
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        } else if (secondWantsWindow) {
            // Primary instance is headless — attach a window to it.
            createWindow();
        }
    });
```

  6. Guard `app.on('activate')` (line 1373): only `createWindow()` when not `cliFlags.headless` or when a window was previously attached (keep it simple: leave as-is; activate only fires from the Dock/taskbar, and creating a window then *is* attaching).
- [ ] Verify: `npm run typecheck && npx vitest run --maxWorkers=2`
- [ ] Manual smoke (documented, not gating): `npx electron dist-electron/main/index.js --headless` after a build shows the tray and no window; launching a second instance without the flag opens the window.
- [ ] Commit: `git add -A && git commit -m "feat: --headless mode — services without a BrowserWindow, windowed second launch attaches"`

---

## Task 5: AxiVale settings — `github` keyring + linked-repo parsing (axivale repo)

All remaining tasks run in `/var/home/mstephens/Documents/GitHub/axivale`.

**Files:**
- Modify: `src/main/secrets.ts:5-12` (SecretKey), `:13-26` (SettingKey), `:29` (KeyService), `:41-57` (ring maps); `src/main/secrets.test.ts` (add cases)
- Create: `src/main/axibridgeRepos.ts`, `src/main/axibridgeRepos.test.ts`

### Steps

- [ ] Write the failing tests. Append to `src/main/secrets.test.ts` (reuse the file's existing in-memory cipher/tmp-path helpers):

```ts
describe('github keyring', () => {
  it('stores and activates GitHub PATs like the gemini ring', () => {
    const store = makeStore() // the file's existing factory helper
    store.addKey('github', 'guild-pat', 'ghp_example123')
    expect(store.listKeyLabels('github')).toEqual([{ label: 'guild-pat', active: true }])
    expect(store.getActiveKey('github')).toBe('ghp_example123')
  })
})
```

  And create `src/main/axibridgeRepos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseRepoRef, listLinkedRepos, serializeLinkedRepos } from './axibridgeRepos'

describe('parseRepoRef', () => {
  it('parses owner/repo', () => {
    expect(parseRepoRef('darkharasho/eww-reports')).toEqual({ owner: 'darkharasho', repo: 'eww-reports' })
  })
  it('parses a GitHub Pages URL', () => {
    expect(parseRepoRef('https://darkharasho.github.io/eww-reports/?report=x')).toEqual({
      owner: 'darkharasho',
      repo: 'eww-reports'
    })
  })
  it('parses a github.com URL and strips .git', () => {
    expect(parseRepoRef('https://github.com/darkharasho/eww-reports.git')).toEqual({
      owner: 'darkharasho',
      repo: 'eww-reports'
    })
  })
  it('rejects garbage', () => {
    expect(parseRepoRef('not a repo')).toBeNull()
    expect(parseRepoRef('')).toBeNull()
    expect(parseRepoRef('a/b/c')).toBeNull()
  })
})

describe('linked repo list round-trip', () => {
  it('serializes and parses, dropping malformed entries', () => {
    const repos = [{ owner: 'darkharasho', repo: 'eww-reports' }]
    expect(listLinkedRepos(serializeLinkedRepos(repos))).toEqual(repos)
    expect(listLinkedRepos(null)).toEqual([])
    expect(listLinkedRepos('not json')).toEqual([])
    expect(listLinkedRepos('[{"owner":"x"}]')).toEqual([])
  })
})
```

- [ ] Run, expect failure:
  `npx vitest run src/main/axibridgeRepos.test.ts src/main/secrets.test.ts --maxWorkers=2`
- [ ] Modify `src/main/secrets.ts`: add `'githubKeys'` to the `SecretKey` union; add `'githubActiveKey' | 'axibridgeRepos' | 'axibridgeCacheCapBytes'` to the `SettingKey` union; add `'github'` to `KeyService`; add `github: 'githubKeys'` to `RING_SECRET` and `github: 'githubActiveKey'` to `ACTIVE_SETTING` (no `LEGACY_SECRET` entry — there is no legacy single GitHub secret). This exactly follows the `geminiKeys` pattern.
- [ ] Create `src/main/axibridgeRepos.ts`:

```ts
/** Linked AxiBridge report repos: parsing + settings (de)serialization. */

export interface RepoRef {
  owner: string
  repo: string
}

export const repoKey = (ref: RepoRef): string => `${ref.owner}/${ref.repo}`

/**
 * Accepts "owner/repo", a github.com repo URL, or a GitHub Pages URL
 * (https://owner.github.io/repo/...). Returns null for anything else.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  const pages = trimmed.match(/^https?:\/\/([a-z0-9-]+)\.github\.io\/([^/?#]+)/i)
  if (pages) return { owner: pages[1], repo: pages[2] }
  const githubUrl = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?$/i)
  if (githubUrl) return { owner: githubUrl[1], repo: githubUrl[2] }
  const plain = trimmed.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/)
  if (plain) return { owner: plain[1], repo: plain[2] }
  return null
}

/** Parse the axibridgeRepos setting (JSON array). Tolerates null/garbage. */
export function listLinkedRepos(raw: string | null): RepoRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is RepoRef => typeof r?.owner === 'string' && typeof r?.repo === 'string')
      .map((r) => ({ owner: r.owner, repo: r.repo }))
  } catch {
    return []
  }
}

export function serializeLinkedRepos(repos: RepoRef[]): string {
  return JSON.stringify(repos.map((r) => ({ owner: r.owner, repo: r.repo })))
}
```

- [ ] Run, expect pass: `npx vitest run src/main/axibridgeRepos.test.ts src/main/secrets.test.ts --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: github PAT keyring service + linked AxiBridge repo setting parsing"`

---

## Task 6: `src/main/axibridgeClient.ts` — fetch with PAT, Pages fallback, actionable errors (axivale repo)

**Files:**
- Create: `src/main/axibridgeClient.ts`, `src/main/axibridgeClient.test.ts`

### Steps

- [ ] Write the failing test `src/main/axibridgeClient.test.ts` (stub HTTP server pattern, mirrors `gw2Client.test.ts` style; the client takes a base-URL override so tests never hit GitHub):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { AxibridgeClient, AxibridgeError } from './axibridgeClient'

const repo = { owner: 'darkharasho', repo: 'eww-reports' }
let server: Server
let base: string
let requests: Array<{ url: string; auth: string | undefined }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', auth: req.headers.authorization })
    if (req.url === '/raw/darkharasho/eww-reports/main/reports/index.json') {
      res.end(JSON.stringify({ entries: [{ id: 'r1', title: 'Reset', dateStart: '2026-01-17', dateEnd: '2026-01-17', commanders: [] }] }))
    } else if (req.url === '/raw/darkharasho/eww-reports/main/reports/rollup.json') {
      res.writeHead(404).end()
    } else if (req.url === '/pages/darkharasho/eww-reports/reports/rollup.json') {
      res.end(JSON.stringify({ version: 1, sources: [], rollup: { commanderRows: [], playerRows: [], sourceReports: 0, uniqueRaids: 0, duplicateReportsCollapsed: 0, raidsSkippedMissingRequiredData: 0, reportsWithCommanderDetails: 0, reportsMissingCommanderDetails: 0, reportsWithAttendanceDetails: 0, reportsMissingAttendanceDetails: 0 } }))
    } else if (req.url?.includes('rate-limited')) {
      res.writeHead(403).end('rate limit exceeded')
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})
afterAll(() => server.close())

function makeClient(pat: string | null = null): AxibridgeClient {
  return new AxibridgeClient(() => pat, {
    rawBase: (r, branch) => `${base}/raw/${r.owner}/${r.repo}/${branch}`,
    pagesBase: (r) => `${base}/pages/${r.owner}/${r.repo}`
  })
}

describe('AxibridgeClient', () => {
  it('fetches index.json from raw and normalizes {entries} vs array', async () => {
    const entries = await makeClient().fetchIndex(repo)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('r1')
  })
  it('sends the PAT as an Authorization header', async () => {
    requests = []
    await makeClient('ghp_tok').fetchIndex(repo)
    expect(requests[0].auth).toBe('Bearer ghp_tok')
  })
  it('falls back to the Pages URL when raw 404s', async () => {
    const rollup = await makeClient().fetchRollup(repo)
    expect(rollup).not.toBeNull()
    expect(rollup!.version).toBe(1)
  })
  it('returns null rollup when absent everywhere', async () => {
    const missing = { owner: 'darkharasho', repo: 'no-such' }
    await expect(makeClient().fetchRollup(missing)).resolves.toBeNull()
  })
  it('names the repo in not-found errors and keeps other repos unaffected', async () => {
    const missing = { owner: 'darkharasho', repo: 'no-such' }
    await expect(makeClient().fetchIndex(missing)).rejects.toMatchObject({
      code: 'not-found',
      message: expect.stringContaining('darkharasho/no-such')
    })
  })
  it('suggests adding a PAT on rate limits', async () => {
    const limited = { owner: 'darkharasho', repo: 'rate-limited' }
    await expect(makeClient().fetchIndex(limited)).rejects.toMatchObject({
      code: 'rate-limited',
      message: expect.stringContaining('PAT')
    })
  })
})
```

- [ ] Run, expect failure: `npx vitest run src/main/axibridgeClient.test.ts --maxWorkers=2`
- [ ] Create `src/main/axibridgeClient.ts`:

```ts
import type { RepoRef } from './axibridgeRepos'
import { repoKey } from './axibridgeRepos'
import { parseRollupSourcesFile, type RollupSourcesFile } from '@axiapps/bridge-metrics'

export type AxibridgeErrorCode = 'not-found' | 'rate-limited' | 'network' | 'schema'

export class AxibridgeError extends Error {
  constructor(
    message: string,
    readonly code: AxibridgeErrorCode
  ) {
    super(message)
  }
}

export interface ReportIndexEntry {
  id: string
  title: string
  commanders: string[]
  dateStart: string | null
  dateEnd: string | null
  dateLabel?: string
  summary?: { avgSquadSize: number | null; avgEnemySize: number | null }
}

/** URL builders are injectable so tests run against a local stub server. */
export interface UrlBuilders {
  rawBase: (repo: RepoRef, branch: string) => string
  pagesBase: (repo: RepoRef) => string
}

const DEFAULT_URLS: UrlBuilders = {
  rawBase: (repo, branch) =>
    `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}`,
  pagesBase: (repo) => `https://${repo.owner}.github.io/${repo.repo}`
}

const BRANCHES = ['main', 'gh-pages']

export class AxibridgeClient {
  constructor(
    private readonly pat: () => string | null,
    private readonly urls: UrlBuilders = DEFAULT_URLS
  ) {}

  private headers(): Record<string, string> {
    const token = this.pat()
    return token
      ? { 'User-Agent': 'AxiVale', Authorization: `Bearer ${token}` }
      : { 'User-Agent': 'AxiVale' }
  }

  /** Candidate URLs in priority order: raw (per branch), then Pages. */
  candidateUrls(repo: RepoRef, relPath: string): string[] {
    return [
      ...BRANCHES.map((branch) => `${this.urls.rawBase(repo, branch)}/${relPath}`),
      `${this.urls.pagesBase(repo)}/${relPath}`
    ]
  }

  /** Fetch a JSON file, trying raw first and the Pages site as fallback.
   *  Returns null when every source 404s (caller decides if that is an error). */
  private async fetchJsonOrNull(repo: RepoRef, relPath: string): Promise<unknown | null> {
    let lastNetworkError: string | null = null
    for (const url of this.candidateUrls(repo, relPath)) {
      let resp: Response
      try {
        // Pages URLs never get the PAT — it is only meaningful to GitHub itself.
        const isPages = url.startsWith(this.urls.pagesBase(repo))
        resp = await fetch(url, { headers: isPages ? { 'User-Agent': 'AxiVale' } : this.headers() })
      } catch {
        lastNetworkError = url
        continue
      }
      if (resp.status === 404) continue
      if (resp.status === 403 || resp.status === 429) {
        throw new AxibridgeError(
          `GitHub rate-limited the request for ${repoKey(repo)} — add a GitHub PAT in Settings to raise the limit.`,
          'rate-limited'
        )
      }
      if (!resp.ok) continue
      try {
        return await resp.json()
      } catch {
        throw new AxibridgeError(`Invalid JSON at ${url}`, 'schema')
      }
    }
    if (lastNetworkError) {
      throw new AxibridgeError(
        `Could not reach ${repoKey(repo)} — check your network connection.`,
        'network'
      )
    }
    return null
  }

  async fetchIndex(repo: RepoRef): Promise<ReportIndexEntry[]> {
    const data = await this.fetchJsonOrNull(repo, 'reports/index.json')
    if (data === null) {
      throw new AxibridgeError(
        `Repo ${repoKey(repo)} is unreachable or has no reports/index.json — check the repo name in Settings. Other linked repos are unaffected.`,
        'not-found'
      )
    }
    // Old repos publish a plain array; newer ones { colorPalette, entries }.
    const entries = Array.isArray(data)
      ? data
      : Array.isArray((data as { entries?: unknown[] })?.entries)
        ? (data as { entries: unknown[] }).entries
        : []
    return entries
      .map((e) => e as Record<string, unknown>)
      .filter((e) => typeof e?.id === 'string')
      .map((e) => ({
        id: String(e.id),
        title: String(e.title ?? e.id),
        commanders: Array.isArray(e.commanders) ? e.commanders.map(String) : [],
        dateStart: typeof e.dateStart === 'string' ? e.dateStart : null,
        dateEnd: typeof e.dateEnd === 'string' ? e.dateEnd : null,
        dateLabel: typeof e.dateLabel === 'string' ? e.dateLabel : undefined,
        summary: (e.summary as ReportIndexEntry['summary']) ?? undefined
      }))
  }

  /** Null when the repo has no rollup.json (older repos) — caller computes locally. */
  async fetchRollup(repo: RepoRef): Promise<RollupSourcesFile | null> {
    const data = await this.fetchJsonOrNull(repo, 'reports/rollup.json')
    if (data === null) return null
    return parseRollupSourcesFile(data)
  }

  async fetchReport(repo: RepoRef, reportId: string): Promise<unknown> {
    const data = await this.fetchJsonOrNull(repo, `reports/${reportId}/report.json`)
    if (data === null) {
      throw new AxibridgeError(
        `Report ${reportId} not found in ${repoKey(repo)}.`,
        'not-found'
      )
    }
    return data
  }
}
```

  Add the dependency to `package.json` `"dependencies"`: `"@axiapps/bridge-metrics": "file:../axibridge/packages/bridge-metrics"`, then `npm install`. (electron-vite bundles main-process deps, so the `file:` symlink is build-time only — same pattern as the existing `gw2-class-icons` file dep.)
- [ ] Run, expect pass: `npx vitest run src/main/axibridgeClient.test.ts --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: axibridgeClient — raw.githubusercontent fetch with PAT, Pages fallback, actionable errors"`

---

## Task 7: disk cache — immutable reports, TTL index/rollup, 2 GB LRU, streaming with retry (axivale repo)

**Files:**
- Create: `src/main/axibridgeCache.ts`, `src/main/axibridgeCache.test.ts`
- Modify: `src/main/axibridgeClient.ts` (add `downloadReport` streaming method), `src/main/axibridgeClient.test.ts` (mid-stream failure case)

### Steps

- [ ] Write the failing test `src/main/axibridgeCache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AxibridgeCache } from './axibridgeCache'

const repo = { owner: 'darkharasho', repo: 'eww-reports' }
let dir: string
let now: number

const makeCache = (capBytes = 2 * 1024 * 1024 * 1024) =>
  new AxibridgeCache({ dir, capBytes, ttlMs: 5 * 60_000, now: () => now })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axibridge-cache-'))
  now = 1_750_000_000_000
})

describe('AxibridgeCache', () => {
  it('treats reports as immutable: a cached report never expires', () => {
    const cache = makeCache()
    cache.putReport(repo, 'r1', JSON.stringify({ meta: { id: 'r1' } }))
    now += 365 * 24 * 3_600_000
    expect(cache.readReport(repo, 'r1')).not.toBeNull()
  })
  it('expires index/rollup after the TTL', () => {
    const cache = makeCache()
    cache.putMeta(repo, 'index', JSON.stringify([{ id: 'r1' }]))
    expect(cache.readMeta(repo, 'index')).not.toBeNull()
    now += 5 * 60_000 + 1
    expect(cache.readMeta(repo, 'index')).toBeNull()
  })
  it('evicts least-recently-used reports past the cap, never summaries', () => {
    const cache = makeCache(250) // tiny cap for the test
    cache.putReport(repo, 'old', 'x'.repeat(200))
    cache.putSummary(repo, 'old', '{"id":"old"}')
    now += 1000
    cache.putReport(repo, 'new', 'y'.repeat(200)) // pushes total past cap
    expect(cache.readReport(repo, 'old')).toBeNull() // evicted (LRU)
    expect(cache.readReport(repo, 'new')).not.toBeNull()
    expect(cache.readSummary(repo, 'old')).toBe('{"id":"old"}') // summaries survive
  })
  it('reading a report refreshes its LRU position', () => {
    const cache = makeCache(450)
    cache.putReport(repo, 'a', 'x'.repeat(200))
    now += 1000
    cache.putReport(repo, 'b', 'y'.repeat(200))
    now += 1000
    cache.readReport(repo, 'a') // a is now most recent
    now += 1000
    cache.putReport(repo, 'c', 'z'.repeat(200))
    expect(cache.readReport(repo, 'b')).toBeNull()
    expect(cache.readReport(repo, 'a')).not.toBeNull()
  })
  it('reports per-repo stats for the Settings health line', () => {
    const cache = makeCache()
    cache.putReport(repo, 'r1', '{}')
    cache.putMeta(repo, 'index', '[]')
    const stats = cache.repoStats(repo)
    expect(stats.cachedReports).toBe(1)
    expect(stats.lastIndexFetch).toBe(now)
  })
})
```

- [ ] Run, expect failure: `npx vitest run src/main/axibridgeCache.test.ts --maxWorkers=2`
- [ ] Create `src/main/axibridgeCache.ts`:

```ts
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync
} from 'fs'
import { join, dirname } from 'path'
import type { RepoRef } from './axibridgeRepos'

export const DEFAULT_CACHE_CAP_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
export const META_TTL_MS = 5 * 60_000 // index/rollup freshness window

export interface CacheOptions {
  dir: string
  capBytes: number
  ttlMs: number
  /** injectable clock for tests */
  now?: () => number
}

interface LedgerEntry {
  size: number
  lastAccess: number
  fetchedAt: number
}

interface Ledger {
  // key: "<owner>__<repo>/<kind>/<id>" — kind 'report' | 'summary' | 'meta'
  entries: Record<string, LedgerEntry>
}

/**
 * Disk cache for AxiBridge report repos.
 * - reports/  immutable forever, keyed repo/reportId, LRU-evicted past capBytes
 * - summaries/ extracted per-run summaries — small, never evicted
 * - meta/      index.json + rollup.json — TTL'd (~5 min)
 */
export class AxibridgeCache {
  private readonly now: () => number

  constructor(private readonly opts: CacheOptions) {
    this.now = opts.now ?? Date.now
    mkdirSync(opts.dir, { recursive: true })
  }

  private repoDir(repo: RepoRef): string {
    return join(this.opts.dir, `${repo.owner}__${repo.repo}`)
  }

  private ledgerPath(): string {
    return join(this.opts.dir, 'ledger.json')
  }

  private readLedger(): Ledger {
    try {
      return JSON.parse(readFileSync(this.ledgerPath(), 'utf8')) as Ledger
    } catch {
      return { entries: {} }
    }
  }

  private writeLedger(ledger: Ledger): void {
    writeFileSync(this.ledgerPath(), JSON.stringify(ledger))
  }

  private key(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string): string {
    return `${repo.owner}__${repo.repo}/${kind}/${id}`
  }

  private pathFor(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string): string {
    return join(this.repoDir(repo), kind, `${id}.json`)
  }

  private put(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string, body: string): void {
    const path = this.pathFor(repo, kind, id)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
    const ledger = this.readLedger()
    ledger.entries[this.key(repo, kind, id)] = {
      size: Buffer.byteLength(body),
      lastAccess: this.now(),
      fetchedAt: this.now()
    }
    this.writeLedger(ledger)
    if (kind === 'report') this.enforceCap()
  }

  private read(repo: RepoRef, kind: 'report' | 'summary' | 'meta', id: string): string | null {
    const path = this.pathFor(repo, kind, id)
    if (!existsSync(path)) return null
    const ledger = this.readLedger()
    const entry = ledger.entries[this.key(repo, kind, id)]
    if (kind === 'meta') {
      if (!entry || this.now() - entry.fetchedAt > this.opts.ttlMs) return null
    }
    if (entry) {
      entry.lastAccess = this.now()
      this.writeLedger(ledger)
    }
    return readFileSync(path, 'utf8')
  }

  putReport(repo: RepoRef, id: string, body: string): void { this.put(repo, 'report', id, body) }
  readReport(repo: RepoRef, id: string): string | null { return this.read(repo, 'report', id) }
  reportPath(repo: RepoRef, id: string): string { return this.pathFor(repo, 'report', id) }
  hasReport(repo: RepoRef, id: string): boolean { return existsSync(this.pathFor(repo, 'report', id)) }

  putSummary(repo: RepoRef, id: string, body: string): void { this.put(repo, 'summary', id, body) }
  readSummary(repo: RepoRef, id: string): string | null { return this.read(repo, 'summary', id) }
  summaryPath(repo: RepoRef, id: string): string { return this.pathFor(repo, 'summary', id) }

  putMeta(repo: RepoRef, name: 'index' | 'rollup', body: string): void { this.put(repo, 'meta', name, body) }
  readMeta(repo: RepoRef, name: 'index' | 'rollup'): string | null { return this.read(repo, 'meta', name) }

  /** LRU eviction over reports only — extracted summaries always survive. */
  private enforceCap(): void {
    const ledger = this.readLedger()
    const reports = Object.entries(ledger.entries)
      .filter(([key]) => key.includes('/report/'))
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess) // oldest first
    let total = reports.reduce((sum, [, e]) => sum + e.size, 0)
    for (const [key, entry] of reports) {
      if (total <= this.opts.capBytes) break
      const [repoPart, , id] = key.split('/')
      const [owner, repoName] = repoPart.split('__')
      const path = this.pathFor({ owner, repo: repoName }, 'report', id)
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        continue // keep the ledger honest only for what we actually removed
      }
      delete ledger.entries[key]
      total -= entry.size
    }
    this.writeLedger(ledger)
  }

  repoStats(repo: RepoRef): { cachedReports: number; lastIndexFetch: number | null; cacheBytes: number } {
    const reportsDir = join(this.repoDir(repo), 'report')
    let cachedReports = 0
    let cacheBytes = 0
    if (existsSync(reportsDir)) {
      for (const file of readdirSync(reportsDir)) {
        cachedReports += 1
        cacheBytes += statSync(join(reportsDir, file)).size
      }
    }
    const entry = this.readLedger().entries[this.key(repo, 'meta', 'index')]
    return { cachedReports, lastIndexFetch: entry?.fetchedAt ?? null, cacheBytes }
  }
}
```

- [ ] Run, expect pass: `npx vitest run src/main/axibridgeCache.test.ts --maxWorkers=2`
- [ ] Add the streaming download to `AxibridgeClient` (append to `src/main/axibridgeClient.ts`):

```ts
export interface DownloadProgress {
  repo: string
  reportId: string
  receivedBytes: number
  totalBytes: number | null
}

const MAX_DOWNLOAD_ATTEMPTS = 3
const RETRY_BASE_MS = 500

/** Streamed report download with retry/backoff. Returns the full body text.
 *  Mid-stream failures discard the partial buffer and retry; after
 *  MAX_DOWNLOAD_ATTEMPTS the last error propagates. */
export async function downloadReport(
  client: AxibridgeClient,
  repo: RepoRef,
  reportId: string,
  onProgress: (p: DownloadProgress) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<string> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
    for (const url of client.candidateUrls(repo, `reports/${reportId}/report.json`)) {
      try {
        const resp = await fetch(url, { headers: { 'User-Agent': 'AxiVale' } })
        if (resp.status === 404) continue
        if (resp.status === 403 || resp.status === 429) {
          throw new AxibridgeError(
            `GitHub rate-limited the download of ${reportId} from ${repoKey(repo)} — add a GitHub PAT in Settings.`,
            'rate-limited'
          )
        }
        if (!resp.ok || !resp.body) continue
        const totalBytes = Number(resp.headers.get('content-length')) || null
        const reader = resp.body.getReader()
        const chunks: Uint8Array[] = []
        let receivedBytes = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          receivedBytes += value.byteLength
          onProgress({ repo: repoKey(repo), reportId, receivedBytes, totalBytes })
        }
        return Buffer.concat(chunks).toString('utf8') // only complete bodies reach here
      } catch (err) {
        if (err instanceof AxibridgeError && err.code === 'rate-limited') throw err
        lastError = err // partial chunks are dropped; loop retries with backoff
      }
    }
  }
  throw new AxibridgeError(
    `Download of report ${reportId} from ${repoKey(repo)} failed after ${MAX_DOWNLOAD_ATTEMPTS} attempts${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}.`,
    'network'
  )
}
```

  Note: `downloadReport` calls `client.candidateUrls(...)` — already public from Task 6. PAT for private-repo raw downloads: route the header through `client` by making `headers()` public as `authHeaders()` and using it for non-Pages URLs (mirror the logic in `fetchJsonOrNull`).
- [ ] Add the mid-stream failure test to `src/main/axibridgeClient.test.ts` — a stub route that sends `Content-Length: 100` but destroys the socket after 10 bytes, twice, then serves the full body; assert `downloadReport` resolves with the full body, that `onProgress` was called, and that the injected `sleep` saw backoff delays `[500, 1000]` when the route always fails (second assertion with an always-failing route expects the final `AxibridgeError` with code `'network'`).
- [ ] Run all client + cache tests, expect pass:
  `npx vitest run src/main/axibridgeClient.test.ts src/main/axibridgeCache.test.ts --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: axibridge disk cache (immutable reports, TTL meta, LRU cap) + streaming downloads with retry"`

---

## Task 8: aggregation worker + per-run summary cache (axivale repo)

**Files:**
- Create: `src/main/axibridgeSummarize.ts` (pure job runner), `src/main/axibridgeWorker.ts` (worker-thread entry), `src/main/axibridgeSummarize.test.ts`
- Modify: `electron.vite.config.ts` (add `axibridgeWorker` as an extra main-process input)

### Steps

- [ ] Write the failing test `src/main/axibridgeSummarize.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSummaryJobs } from './axibridgeSummarize'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axibridge-sum-'))
})

const report = {
  meta: { id: 'r1', title: 'Reset', dateStart: '2026-01-17T17:51:20Z', dateEnd: '2026-01-17T19:00:00Z' },
  stats: { total: 3, wins: 2, losses: 1, attendanceData: [{ account: 'P.1', characterNames: [], combatTimeMs: 1, squadTimeMs: 2, classTimes: [] }] }
}

describe('runSummaryJobs', () => {
  it('parses reports, writes summary cache files, returns summaries', () => {
    const reportPath = join(dir, 'r1.json')
    const summaryPath = join(dir, 'r1.summary.json')
    writeFileSync(reportPath, JSON.stringify(report))
    const result = runSummaryJobs([{ id: 'r1', reportPath, summaryPath }])
    expect(result.summaries).toHaveLength(1)
    expect(result.summaries[0].fights).toBe(3)
    expect(existsSync(summaryPath)).toBe(true)
  })
  it('reuses an existing summary without re-parsing the report', () => {
    const summaryPath = join(dir, 'r1.summary.json')
    writeFileSync(summaryPath, JSON.stringify({ id: 'r1', fights: 99, wins: 0, losses: 0, players: [], warnings: [], commanders: [], title: 'cached', dateStart: null, dateEnd: null, avgSquadSize: null, avgEnemies: null, squadDeaths: 0, squadDowns: 0, enemyDeaths: 0, enemyDowns: 0 }))
    const result = runSummaryJobs([{ id: 'r1', reportPath: join(dir, 'missing.json'), summaryPath }])
    expect(result.summaries[0].fights).toBe(99) // report file untouched
  })
  it('reports skipped runs with reasons instead of silently dropping them', () => {
    const badPath = join(dir, 'bad.json')
    writeFileSync(badPath, '{"stats": {}}') // no meta.id
    const result = runSummaryJobs([{ id: 'bad', reportPath: badPath, summaryPath: join(dir, 'bad.summary.json') }])
    expect(result.summaries).toHaveLength(0)
    expect(result.skipped).toEqual([{ id: 'bad', reason: expect.stringContaining('meta.id') }])
  })
})
```

- [ ] Run, expect failure: `npx vitest run src/main/axibridgeSummarize.test.ts --maxWorkers=2`
- [ ] Create `src/main/axibridgeSummarize.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { extractRunSummary, type RunSummary } from '@axiapps/bridge-metrics'

export interface SummaryJob {
  id: string
  reportPath: string
  summaryPath: string
}

export interface SummaryJobResult {
  summaries: RunSummary[]
  skipped: Array<{ id: string; reason: string }>
}

/**
 * Synchronous job runner shared by the worker thread and unit tests.
 * Parsing a 30 MB report.json is the expensive part — once a run's summary
 * exists on disk it is reused and the raw report is never re-parsed.
 */
export function runSummaryJobs(jobs: SummaryJob[]): SummaryJobResult {
  const summaries: RunSummary[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  for (const job of jobs) {
    try {
      if (existsSync(job.summaryPath)) {
        summaries.push(JSON.parse(readFileSync(job.summaryPath, 'utf8')) as RunSummary)
        continue
      }
      const report = JSON.parse(readFileSync(job.reportPath, 'utf8'))
      const summary = extractRunSummary(report)
      writeFileSync(job.summaryPath, JSON.stringify(summary))
      summaries.push(summary)
    } catch (err) {
      skipped.push({ id: job.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { summaries, skipped }
}
```

- [ ] Create `src/main/axibridgeWorker.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads'
import { runSummaryJobs, type SummaryJob } from './axibridgeSummarize'

const { jobs } = workerData as { jobs: SummaryJob[] }
parentPort!.postMessage(runSummaryJobs(jobs))
```

  And the main-process wrapper (append to `src/main/axibridgeSummarize.ts`):

```ts
import { Worker } from 'node:worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

/** Run the jobs in a worker thread so a season of 30 MB parses never blocks main. */
export function summarizeInWorker(jobs: SummaryJob[]): Promise<SummaryJobResult> {
  if (jobs.length === 0) return Promise.resolve({ summaries: [], skipped: [] })
  const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'axibridgeWorker.mjs')
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { jobs } })
    worker.once('message', (result: SummaryJobResult) => {
      resolve(result)
      void worker.terminate()
    })
    worker.once('error', reject)
  })
}
```

- [ ] Modify `electron.vite.config.ts`: add a second rollup input for the main build so the worker compiles to its own file, e.g. under the existing `main` config:

```ts
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          axibridgeWorker: 'src/main/axibridgeWorker.ts'
        },
        output: { entryFileNames: '[name].mjs' }
      }
    }
```

  (Merge with whatever `main.build` options already exist in the file — read it first; if `output.entryFileNames` conflicts with the existing main output naming `index.js`, adjust `workerPath` in `summarizeInWorker` to match the actual emitted filename and verify with `npm run build`.)
- [ ] Run, expect pass: `npx vitest run src/main/axibridgeSummarize.test.ts --maxWorkers=2`
- [ ] Verify the app still builds with the extra entry: `npm run build`
- [ ] Commit: `git add -A && git commit -m "feat: worker-thread report summarizer with on-disk per-run summary cache"`

---

## Task 9: `AxibridgeService` — orchestration, range filters, rollup fallback, skipped-run reporting (axivale repo)

**Files:**
- Create: `src/main/axibridgeService.ts`, `src/main/axibridgeService.test.ts`

### Steps

- [ ] Write the failing test `src/main/axibridgeService.test.ts` (fake client + real cache in a tmp dir; no network):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AxibridgeService } from './axibridgeService'
import { AxibridgeCache } from './axibridgeCache'
import { AxibridgeError } from './axibridgeClient'

const repoA = { owner: 'o', repo: 'a' }
const report = (id: string, dateStart: string) => ({
  meta: { id, title: id, dateStart, dateEnd: dateStart },
  stats: {
    total: 2, wins: 1, losses: 1,
    attendanceData: [{ account: 'P.1', characterNames: [], combatTimeMs: 60_000, squadTimeMs: 120_000, classTimes: [{ profession: 'Scourge', timeMs: 60_000 }] }],
    commanderStats: { rows: [{ account: 'C.1', characterNames: [], profession: 'Firebrand', fights: 2, kills: 5, downs: 7, commanderDeaths: 0, alliesDead: 1, wins: 1, losses: 1 }] },
    offensePlayers: [{ account: 'P.1', profession: 'Scourge', professionList: ['Scourge'], totalFightMs: 60_000, offenseTotals: { damage: 100_000, killed: 1, downed: 2, downContribution: 5_000, boonStrips: 4 }, offenseRateWeights: {} }]
  }
})

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axibridge-svc-'))
  const cache = new AxibridgeCache({ dir, capBytes: 2 ** 31, ttlMs: 300_000 })
  const fakeClient = {
    fetchIndex: async () => [
      { id: 'r1', title: 'Run 1', commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: '2026-06-01T21:00:00Z' },
      { id: 'r2', title: 'Run 2', commanders: ['C.1'], dateStart: '2026-06-08T19:00:00Z', dateEnd: '2026-06-08T21:00:00Z' }
    ],
    fetchRollup: async () => null, // older repo: forces local computation
    fetchReport: async (_repo: unknown, id: string) =>
      id === 'r1' ? report('r1', '2026-06-01T19:00:00Z') : report('r2', '2026-06-08T19:00:00Z'),
    ...overrides
  }
  return new AxibridgeService({
    repos: () => [repoA],
    client: fakeClient as never,
    cache,
    // run jobs inline in tests instead of spawning a worker thread
    summarize: async (jobs) => (await import('./axibridgeSummarize')).runSummaryJobs(jobs),
    onProgress: () => {}
  })
}

describe('AxibridgeService', () => {
  it('lists runs across linked repos with date filtering', async () => {
    const svc = makeService()
    const all = await svc.runsList({})
    expect(all.runs).toHaveLength(2)
    const filtered = await svc.runsList({ from: '2026-06-05' })
    expect(filtered.runs.map((r) => r.id)).toEqual(['r2'])
  })
  it('computes the rollup locally when rollup.json is absent', async () => {
    const svc = makeService()
    const result = await svc.commanderStats({})
    expect(result.commanders[0].account).toBe('C.1')
    expect(result.commanders[0].fightsLed).toBe(4) // 2 fights × 2 runs
    expect(result.rollupSource).toBe('computed-locally')
  })
  it('aggregates player stats over cached summaries and reports skipped runs', async () => {
    const svc = makeService({
      fetchReport: async (_repo: unknown, id: string) =>
        id === 'r1' ? report('r1', '2026-06-01T19:00:00Z') : { stats: {} } // r2 has no meta.id
    })
    const result = await svc.playerStats({})
    expect(result.players[0].account).toBe('P.1')
    expect(result.players[0].runsJoined).toBe(1)
    expect(result.skippedRuns).toEqual([{ id: 'r2', reason: expect.stringContaining('meta.id') }])
  })
  it('one broken repo does not break the others', async () => {
    const svc = makeService({
      fetchIndex: async (repo: { repo: string }) => {
        throw new AxibridgeError(`Repo o/${repo.repo} is unreachable`, 'not-found')
      }
    })
    const status = await svc.reposStatus()
    expect(status.repos[0].error).toContain('o/a')
  })
})
```

- [ ] Run, expect failure: `npx vitest run src/main/axibridgeService.test.ts --maxWorkers=2`
- [ ] Create `src/main/axibridgeService.ts`:

```ts
import type { RepoRef } from './axibridgeRepos'
import { repoKey } from './axibridgeRepos'
import { AxibridgeClient, AxibridgeError, downloadReport, type ReportIndexEntry, type DownloadProgress } from './axibridgeClient'
import { AxibridgeCache } from './axibridgeCache'
import type { SummaryJob, SummaryJobResult } from './axibridgeSummarize'
import {
  aggregatePlayers, compareRunSets, buildRollupData, extractRollupSource,
  type RunSummary, type RollupData, type RollupReportPayload
} from '@axiapps/bridge-metrics'

export interface AxibridgeServiceDeps {
  repos: () => RepoRef[]
  client: AxibridgeClient
  cache: AxibridgeCache
  summarize: (jobs: SummaryJob[]) => Promise<SummaryJobResult>
  /** UI progress: "fetching run 3 of 12" */
  onProgress: (message: string, detail?: DownloadProgress) => void
}

export interface RunListEntry extends ReportIndexEntry {
  repo: string
}

export interface DateRange {
  from?: string
  to?: string
}

const inRange = (entry: ReportIndexEntry, range: DateRange): boolean => {
  const date = entry.dateStart ?? entry.dateEnd
  if (!date) return true
  if (range.from && date < range.from) return false
  if (range.to && date.slice(0, 10) > range.to) return false
  return true
}

export class AxibridgeService {
  constructor(private readonly deps: AxibridgeServiceDeps) {}

  private requireRepos(): RepoRef[] {
    const repos = this.deps.repos()
    if (repos.length === 0) {
      throw new Error('No AxiBridge report repos linked — add one in Settings (owner/repo or Pages URL).')
    }
    return repos
  }

  /** index.json per repo, cache-first (5 min TTL). Errors isolated per repo. */
  private async indexFor(repo: RepoRef): Promise<ReportIndexEntry[]> {
    const cached = this.deps.cache.readMeta(repo, 'index')
    if (cached) return JSON.parse(cached) as ReportIndexEntry[]
    const entries = await this.deps.client.fetchIndex(repo)
    this.deps.cache.putMeta(repo, 'index', JSON.stringify(entries))
    return entries
  }

  async reposStatus(): Promise<{
    repos: Array<{ repo: string; runs: number; firstRun: string | null; lastRun: string | null; cachedReports: number; lastIndexFetch: number | null; error: string | null }>
  }> {
    const out = []
    for (const repo of this.deps.repos()) {
      const stats = this.deps.cache.repoStats(repo)
      try {
        const entries = await this.indexFor(repo)
        const dates = entries.map((e) => e.dateStart).filter((d): d is string => !!d).sort()
        out.push({
          repo: repoKey(repo), runs: entries.length,
          firstRun: dates[0] ?? null, lastRun: dates[dates.length - 1] ?? null,
          cachedReports: stats.cachedReports, lastIndexFetch: stats.lastIndexFetch, error: null
        })
      } catch (err) {
        out.push({
          repo: repoKey(repo), runs: 0, firstRun: null, lastRun: null,
          cachedReports: stats.cachedReports, lastIndexFetch: stats.lastIndexFetch,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return { repos: out }
  }

  async runsList(filter: DateRange & { repo?: string }): Promise<{ runs: RunListEntry[]; errors: string[] }> {
    const repos = this.requireRepos().filter((r) => !filter.repo || repoKey(r) === filter.repo)
    const runs: RunListEntry[] = []
    const errors: string[] = []
    for (const repo of repos) {
      try {
        for (const entry of await this.indexFor(repo)) {
          if (inRange(entry, filter)) runs.push({ ...entry, repo: repoKey(repo) })
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err)) // other repos unaffected
      }
    }
    runs.sort((a, b) => String(b.dateStart ?? '').localeCompare(String(a.dateStart ?? '')))
    return { runs, errors }
  }

  /** Download any uncached reports (with progress), then summarize via the worker. */
  async summariesFor(runs: RunListEntry[]): Promise<{ summaries: RunSummary[]; skippedRuns: Array<{ id: string; reason: string }> }> {
    const repos = new Map(this.deps.repos().map((r) => [repoKey(r), r]))
    const jobs: SummaryJob[] = []
    let fetched = 0
    const toFetch = runs.filter((run) => {
      const repo = repos.get(run.repo)
      return repo && !this.deps.cache.hasReport(repo, run.id) && !this.deps.cache.readSummary(repo, run.id)
    })
    for (const run of runs) {
      const repo = repos.get(run.repo)
      if (!repo) continue
      if (!this.deps.cache.hasReport(repo, run.id) && !this.deps.cache.readSummary(repo, run.id)) {
        fetched += 1
        this.deps.onProgress(`fetching run ${fetched} of ${toFetch.length}`)
        const body = JSON.stringify(await this.deps.client.fetchReport(repo, run.id))
        this.deps.cache.putReport(repo, run.id, body)
      }
      jobs.push({
        id: run.id,
        reportPath: this.deps.cache.reportPath(repo, run.id),
        summaryPath: this.deps.cache.summaryPath(repo, run.id)
      })
    }
    const result = await this.deps.summarize(jobs)
    return { summaries: result.summaries, skippedRuns: result.skipped }
  }

  async runSummary(runId: string): Promise<{ summary: RunSummary; skippedRuns: Array<{ id: string; reason: string }> }> {
    const { runs } = await this.runsList({})
    const run = runs.find((r) => r.id === runId)
    if (!run) throw new Error(`Run ${runId} not found in any linked repo — call axibridge_runs_list for valid ids.`)
    const { summaries, skippedRuns } = await this.summariesFor([run])
    if (summaries.length === 0) {
      throw new Error(`Run ${runId} could not be summarized: ${skippedRuns[0]?.reason ?? 'unknown'}`)
    }
    return { summary: summaries[0], skippedRuns }
  }

  async playerStats(args: DateRange & { accounts?: string[] }) {
    const { runs, errors } = await this.runsList(args)
    const { summaries, skippedRuns } = await this.summariesFor(runs)
    return { players: aggregatePlayers(summaries, args.accounts), runsConsidered: summaries.length, skippedRuns, errors }
  }

  /** Rollup-backed: published rollup.json when present, else computed locally. */
  private async rollupFor(repo: RepoRef): Promise<{ rollup: RollupData; source: 'published' | 'computed-locally' }> {
    const cached = this.deps.cache.readMeta(repo, 'rollup')
    if (cached) return JSON.parse(cached) as { rollup: RollupData; source: 'published' | 'computed-locally' }
    const published = await this.deps.client.fetchRollup(repo)
    let result: { rollup: RollupData; source: 'published' | 'computed-locally' }
    if (published) {
      result = { rollup: published.rollup, source: 'published' }
    } else {
      // Older repo without rollup.json — build it from full reports via bridge-metrics.
      const entries = await this.indexFor(repo)
      const sources: RollupReportPayload[] = []
      for (const entry of entries) {
        let body = this.deps.cache.readReport(repo, entry.id)
        if (!body) {
          body = JSON.stringify(await this.deps.client.fetchReport(repo, entry.id))
          this.deps.cache.putReport(repo, entry.id, body)
        }
        sources.push(extractRollupSource(JSON.parse(body) as RollupReportPayload))
      }
      result = { rollup: buildRollupData(sources), source: 'computed-locally' }
    }
    this.deps.cache.putMeta(repo, 'rollup', JSON.stringify(result))
    return result
  }

  async attendance(args: DateRange) {
    const rows: RollupData['playerRows'] = []
    let rollupSource: 'published' | 'computed-locally' = 'published'
    for (const repo of this.requireRepos()) {
      const { rollup, source } = await this.rollupFor(repo)
      if (source === 'computed-locally') rollupSource = source
      rows.push(...rollup.playerRows)
    }
    return { attendance: rows, rollupSource, range: args }
  }

  async commanderStats(args: DateRange) {
    const rows: RollupData['commanderRows'] = []
    let rollupSource: 'published' | 'computed-locally' = 'published'
    for (const repo of this.requireRepos()) {
      const { rollup, source } = await this.rollupFor(repo)
      if (source === 'computed-locally') rollupSource = source
      rows.push(...rollup.commanderRows)
    }
    return { commanders: rows, rollupSource, range: args }
  }

  /** a/b are run ids or date ranges "YYYY-MM-DD..YYYY-MM-DD". */
  async compare(a: string, b: string) {
    const resolve = async (spec: string): Promise<RunSummary[]> => {
      const rangeMatch = spec.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/)
      const { runs } = await this.runsList(
        rangeMatch ? { from: rangeMatch[1], to: rangeMatch[2] } : {}
      )
      const selected = rangeMatch ? runs : runs.filter((r) => r.id === spec)
      if (selected.length === 0) throw new Error(`No runs match "${spec}" — pass a run id from axibridge_runs_list or a range YYYY-MM-DD..YYYY-MM-DD.`)
      return (await this.summariesFor(selected)).summaries
    }
    const [setA, setB] = await Promise.all([resolve(a), resolve(b)])
    return { a, b, runsA: setA.length, runsB: setB.length, comparison: compareRunSets(setA, setB) }
  }
}
```

  Note: `attendance`/`commanderStats` use the cross-run rollup (the published artifact intentionally spans all runs); `range` is echoed back so the model knows the rollup is all-time when a narrower range was requested — narrowing per-range attendance happens via `playerStats` which does honor ranges.
- [ ] Run, expect pass: `npx vitest run src/main/axibridgeService.test.ts --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: AxibridgeService — runs, summaries, rollup fallback, comparisons, skipped-run reporting"`

---

## Task 10: tool suite `src/main/tools/axibridge.ts` (axivale repo)

**Files:**
- Create: `src/main/tools/axibridge.ts`, `src/main/tools/axibridge.test.ts`
- Modify: `src/main/tools.ts:6-13` (extend `ToolDeps`), `:82` (`buildOfficerTools` spreads the new tools)

### Steps

- [ ] Write the failing test `src/main/tools/axibridge.test.ts` (handler-call pattern copied from `tools.test.ts` — tools expose `.name` and `.handler(args, extra)`):

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildAxibridgeTools } from './axibridge'

const fakeService = {
  reposStatus: vi.fn(async () => ({ repos: [{ repo: 'o/a', runs: 2, firstRun: '2026-06-01', lastRun: '2026-06-08', cachedReports: 1, lastIndexFetch: 1, error: null }] })),
  runsList: vi.fn(async () => ({ runs: [{ id: 'r1', title: 'Run 1', repo: 'o/a', commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: '2026-06-01T21:00:00Z' }], errors: [] })),
  runSummary: vi.fn(async () => ({ summary: { id: 'r1', title: 'Run 1', fights: 2, wins: 1, losses: 1, squadDeaths: 3, squadDowns: 5, enemyDeaths: 8, enemyDowns: 12, avgSquadSize: 25, avgEnemies: 30, commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: null, players: [], warnings: [] }, skippedRuns: [] })),
  playerStats: vi.fn(async () => ({ players: [{ account: 'P.1', runsJoined: 2, dps: 1200, damage: 100, combatTimeMs: 1, squadTimeMs: 2, professionTimeMs: { Scourge: 1 }, downContribution: 1, kills: 1, strips: 1, cleanses: 1, resurrects: 0, healing: 0, barrier: 0, damageTaken: 1, downs: 0, deaths: 0, lastSeen: '2026-06-08' }], runsConsidered: 2, skippedRuns: [], errors: [] })),
  attendance: vi.fn(async () => ({ attendance: [{ account: 'P.1', characterNames: [], profession: 'Scourge', runs: 2, combatTimeMs: 1, squadTimeMs: 2, lastSeenTs: 1 }], rollupSource: 'published', range: {} })),
  commanderStats: vi.fn(async () => ({ commanders: [{ account: 'C.1', characterNames: [], profession: 'Firebrand', runs: 2, fightsLed: 4, kills: 10, downs: 14, commanderDeaths: 0, alliesDead: 2, wins: 2, losses: 2, kdr: 5, lastSeenTs: 1 }], rollupSource: 'published', range: {} })),
  compare: vi.fn(async () => ({ a: 'r1', b: 'r2', runsA: 1, runsB: 1, comparison: { metrics: [{ metric: 'squadDeaths', a: 3, b: 1, delta: -2, deltaPct: -2 / 3 }] } }))
}

const tools = buildAxibridgeTools(() => fakeService as never)
const byName = (name: string) => tools.find((t) => t.name === name)!
const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text)

describe('axibridge tools', () => {
  it('registers exactly the spec table', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'axibridge_attendance',
      'axibridge_commander_stats',
      'axibridge_compare',
      'axibridge_player_stats',
      'axibridge_render_chart',
      'axibridge_repos_status',
      'axibridge_run_summary',
      'axibridge_runs_list'
    ])
  })
  it('repos_status returns compact JSON and a table display', async () => {
    const res = (await byName('axibridge_repos_status').handler({}, {})) as never as {
      content: Array<{ text: string }>
      display?: { kind: string; data: { columns: Array<{ key: string }> } }
    }
    expect(parse(res).repos[0].repo).toBe('o/a')
    expect(res.display?.kind).toBe('table')
    expect(res.display?.data.columns.map((c) => c.key)).toContain('runs')
  })
  it('attendance attaches both a table and a chart-capable payload', async () => {
    const res = (await byName('axibridge_attendance').handler({}, {})) as never as { display?: { kind: string } }
    expect(res.display?.kind).toBe('table')
  })
  it('compare attaches a chart display with the spec shape', async () => {
    const res = (await byName('axibridge_compare').handler({ a: 'r1', b: 'r2' }, {})) as never as {
      display?: { kind: string; data: { type: string; xKey: string; series: Array<{ key: string }>; rows: unknown[] } }
    }
    expect(res.display?.kind).toBe('chart')
    expect(res.display?.data.type).toBe('bar')
    expect(res.display?.data.xKey).toBe('metric')
    expect(res.display?.data.series.map((s) => s.key)).toEqual(['a', 'b'])
  })
  it('render_chart validates and echoes the spec', async () => {
    const spec = { type: 'line' as const, title: 'DPS over runs', xKey: 'run', series: [{ key: 'dps', label: 'DPS' }], rows: [{ run: 'r1', dps: 1200 }] }
    const res = (await byName('axibridge_render_chart').handler({ spec }, {})) as never as { display?: { kind: string; data: unknown } }
    expect(res.display?.kind).toBe('chart')
    expect(res.display?.data).toEqual(spec)
  })
  it('errors surface as MCP error results, not exceptions', async () => {
    fakeService.runSummary.mockRejectedValueOnce(new Error('Run zzz not found'))
    const res = (await byName('axibridge_run_summary').handler({ run_id: 'zzz' }, {})) as never as { isError?: boolean; content: Array<{ text: string }> }
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('zzz')
  })
})
```

- [ ] Run, expect failure: `npx vitest run src/main/tools/axibridge.test.ts --maxWorkers=2`
- [ ] Create `src/main/tools/axibridge.ts`:

```ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AxibridgeService } from '../axibridgeService'

interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface ChartDisplay {
  kind: 'chart'
  data: {
    type: 'line' | 'bar' | 'area'
    title: string
    xKey: string
    series: Array<{ key: string; label: string; color?: string }>
    rows: Array<Record<string, unknown>>
  }
}

export interface TableDisplay {
  kind: 'table'
  data: {
    title?: string
    columns: Array<{ key: string; label: string }>
    rows: Array<Record<string, unknown>>
  }
}

export type DisplayPayload = ChartDisplay | TableDisplay

/** Compact JSON for the model + optional rich display for the renderer.
 *  The extra `display` property rides on the result's index signature; if the
 *  inline-rendering mechanism is not merged yet, the renderer ignores it. */
function okWith(display: DisplayPayload | null, value: unknown): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text: JSON.stringify(value) }] }
  if (display) result.display = display
  return result
}

function safe<A>(fn: (args: A) => Promise<ToolResult>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}

const chartSpecSchema = z.object({
  type: z.enum(['line', 'bar', 'area']),
  title: z.string(),
  xKey: z.string(),
  series: z.array(z.object({ key: z.string(), label: z.string(), color: z.string().optional() })),
  rows: z.array(z.record(z.string(), z.unknown()))
})

const msToHours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxibridgeTools(service: () => AxibridgeService): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'axibridge_repos_status',
      'Status of the linked AxiBridge report repos: run counts, date ranges, and fetch/cache state. Start here when a repo seems empty or unreachable.',
      {},
      safe(async () => {
        const status = await service().reposStatus()
        return okWith(
          {
            kind: 'table',
            data: {
              title: 'Linked AxiBridge repos',
              columns: [
                { key: 'repo', label: 'Repo' },
                { key: 'runs', label: 'Runs' },
                { key: 'firstRun', label: 'First run' },
                { key: 'lastRun', label: 'Last run' },
                { key: 'cachedReports', label: 'Cached' },
                { key: 'error', label: 'Error' }
              ],
              rows: status.repos
            }
          },
          status
        )
      })
    ),
    tool(
      'axibridge_runs_list',
      'List published runs across linked repos, newest first: id, date, title, commander(s). Filter by repo ("owner/repo") and/or ISO date range.',
      {
        repo: z.string().optional().describe('Limit to one repo, e.g. "darkharasho/eww-reports"'),
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safe(async ({ repo, from, to }) => {
        const result = await service().runsList({ repo, from, to })
        const rows = result.runs.map((r) => ({
          id: r.id, date: r.dateStart?.slice(0, 10) ?? '—', title: r.title,
          commanders: r.commanders.join(', '), repo: r.repo,
          squad: r.summary?.avgSquadSize ?? null
        }))
        return okWith(
          {
            kind: 'table',
            data: {
              title: 'Runs',
              columns: [
                { key: 'date', label: 'Date' },
                { key: 'title', label: 'Title' },
                { key: 'commanders', label: 'Commander' },
                { key: 'squad', label: 'Avg squad' },
                { key: 'id', label: 'Run id' }
              ],
              rows
            }
          },
          { runs: rows, errors: result.errors }
        )
      })
    ),
    tool(
      'axibridge_run_summary',
      'Compact summary of one run: fight totals, W/L, squad deaths/downs, per-player metric rows, and top performers. Pass a run id from axibridge_runs_list.',
      { run_id: z.string().describe('Run id, e.g. "20260117-1751"') },
      safe(async ({ run_id }) => {
        const { summary, skippedRuns } = await service().runSummary(run_id)
        const playerRows = summary.players.map((p) => ({
          account: p.account, profession: p.profession,
          damage: p.damage, downContribution: p.downContribution,
          cleanses: p.cleanses, strips: p.strips,
          healing: p.healing, deaths: p.deaths, downs: p.downs
        }))
        const top = (key: 'damage' | 'healing' | 'cleanses' | 'strips') =>
          [...summary.players].sort((a, b) => b[key] - a[key])[0]?.account ?? null
        return okWith(
          {
            kind: 'table',
            data: {
              title: `${summary.title} — ${summary.wins}W/${summary.losses}L over ${summary.fights} fights`,
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'profession', label: 'Profession' },
                { key: 'damage', label: 'Damage' },
                { key: 'downContribution', label: 'Down contrib' },
                { key: 'cleanses', label: 'Cleanses' },
                { key: 'strips', label: 'Strips' },
                { key: 'healing', label: 'Healing' },
                { key: 'deaths', label: 'Deaths' }
              ],
              rows: playerRows
            }
          },
          {
            run: {
              id: summary.id, title: summary.title, date: summary.dateStart,
              fights: summary.fights, wins: summary.wins, losses: summary.losses,
              avgSquadSize: summary.avgSquadSize, avgEnemies: summary.avgEnemies,
              squadDeaths: summary.squadDeaths, squadDowns: summary.squadDowns,
              enemyDeaths: summary.enemyDeaths, enemyDowns: summary.enemyDowns,
              commanders: summary.commanders
            },
            topPerformers: { damage: top('damage'), healing: top('healing'), cleanses: top('cleanses'), strips: top('strips') },
            players: playerRows,
            warnings: summary.warnings,
            skippedRuns
          }
        )
      })
    ),
    tool(
      'axibridge_player_stats',
      'Multi-run per-account aggregates (damage/DPS, healing, cleanses, strips, deaths, profession time). Optionally filter accounts and date range. Runs that could not be parsed are listed in skippedRuns — never silently dropped.',
      {
        accounts: z.array(z.string()).optional().describe('GW2 account names, e.g. ["Logan.1234"]'),
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safe(async ({ accounts, from, to }) => {
        const result = await service().playerStats({ accounts, from, to })
        const rows = result.players.map((p) => ({
          account: p.account, runs: p.runsJoined, dps: Math.round(p.dps),
          damage: p.damage, cleanses: p.cleanses, strips: p.strips,
          healing: p.healing, deaths: p.deaths,
          combatHours: msToHours(p.combatTimeMs),
          professions: Object.keys(p.professionTimeMs).join(', '),
          lastSeen: p.lastSeen
        }))
        return okWith(
          {
            kind: 'table',
            data: {
              title: 'Player stats',
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'runs', label: 'Runs' },
                { key: 'dps', label: 'DPS' },
                { key: 'cleanses', label: 'Cleanses' },
                { key: 'strips', label: 'Strips' },
                { key: 'healing', label: 'Healing' },
                { key: 'deaths', label: 'Deaths' },
                { key: 'combatHours', label: 'Combat h' }
              ],
              rows
            }
          },
          { players: rows, runsConsidered: result.runsConsidered, skippedRuns: result.skippedRuns, errors: result.errors }
        )
      })
    ),
    tool(
      'axibridge_attendance',
      'Attendance per account from the cross-run rollup: runs joined, combat time, squad time, primary profession, last seen.',
      {
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safe(async ({ from, to }) => {
        const result = await service().attendance({ from, to })
        const rows = result.attendance.map((r) => ({
          account: r.account, profession: r.profession, runs: r.runs,
          combatHours: msToHours(r.combatTimeMs), squadHours: msToHours(r.squadTimeMs),
          lastSeen: r.lastSeenTs ? new Date(r.lastSeenTs).toISOString().slice(0, 10) : null
        }))
        return okWith(
          {
            kind: 'table',
            data: {
              title: 'Attendance',
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'profession', label: 'Main profession' },
                { key: 'runs', label: 'Runs' },
                { key: 'combatHours', label: 'Combat h' },
                { key: 'squadHours', label: 'Squad h' },
                { key: 'lastSeen', label: 'Last seen' }
              ],
              rows
            }
          },
          { attendance: rows, rollupSource: result.rollupSource }
        )
      })
    ),
    tool(
      'axibridge_commander_stats',
      'Per-commander record from the cross-run rollup: fights led, W/L, KDR, kills, deaths.',
      {
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safe(async ({ from, to }) => {
        const result = await service().commanderStats({ from, to })
        const rows = result.commanders.map((c) => ({
          account: c.account, profession: c.profession, runs: c.runs,
          fightsLed: c.fightsLed, wins: c.wins, losses: c.losses,
          kdr: Math.round(c.kdr * 100) / 100, kills: c.kills, deaths: c.commanderDeaths
        }))
        return okWith(
          {
            kind: 'table',
            data: {
              title: 'Commanders',
              columns: [
                { key: 'account', label: 'Commander' },
                { key: 'fightsLed', label: 'Fights led' },
                { key: 'wins', label: 'W' },
                { key: 'losses', label: 'L' },
                { key: 'kdr', label: 'KDR' },
                { key: 'deaths', label: 'Deaths' }
              ],
              rows
            }
          },
          { commanders: rows, rollupSource: result.rollupSource }
        )
      })
    ),
    tool(
      'axibridge_compare',
      'Per-metric deltas between two runs or two date ranges. Pass run ids from axibridge_runs_list or ranges as "YYYY-MM-DD..YYYY-MM-DD".',
      {
        a: z.string().describe('Run id or date range "YYYY-MM-DD..YYYY-MM-DD"'),
        b: z.string().describe('Run id or date range "YYYY-MM-DD..YYYY-MM-DD"')
      },
      safe(async ({ a, b }) => {
        const result = await service().compare(a, b)
        const rows = result.comparison.metrics.map((m) => ({ metric: m.metric, a: m.a, b: m.b, delta: m.delta }))
        return okWith(
          {
            kind: 'chart',
            data: {
              type: 'bar',
              title: `Compare ${a} vs ${b}`,
              xKey: 'metric',
              series: [
                { key: 'a', label: a },
                { key: 'b', label: b }
              ],
              rows
            }
          },
          result
        )
      })
    ),
    tool(
      'axibridge_render_chart',
      'Render a chart from any aggregate you computed yourself (e.g. a DPS-per-run trend assembled from axibridge_run_summary calls). rows are objects keyed by xKey and each series key.',
      { spec: chartSpecSchema },
      safe(async ({ spec }) =>
        okWith({ kind: 'chart', data: spec }, { rendered: true, title: spec.title, points: spec.rows.length })
      )
    )
  ]
}
```

- [ ] Wire into `src/main/tools.ts`: add to the imports `import { buildAxibridgeTools } from './tools/axibridge'` and `import type { AxibridgeService } from './axibridgeService'`; extend `ToolDeps` with `axibridge: () => AxibridgeService`; append `...buildAxibridgeTools(deps.axibridge)` to the array returned by `buildOfficerTools` (after the `gw2_guild_log` tool). All axibridge tools are read-only — `DESTRUCTIVE_TOOLS` and `ACTION_GATED_TOOLS` unchanged.
- [ ] Run, expect pass: `npx vitest run src/main/tools/axibridge.test.ts src/main/tools.test.ts --maxWorkers=2` (fix `tools.test.ts` deps fixtures to include the new `axibridge` field).
- [ ] Commit: `git add -A && git commit -m "feat: axibridge analytics tool suite with chart/table display payloads"`

---

## Task 11: system prompt — analytics methodology (axivale repo)

**Files:**
- Modify: `src/main/agent.ts:12-53` (`AXIVALE_SYSTEM_PROMPT`)
- Modify: `src/main/agent.test.ts` (assert the new section is present, following the file's existing prompt assertions)

### Steps

- [ ] Add a failing assertion to `src/main/agent.test.ts`:

```ts
it('system prompt includes the analytics methodology section', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('./agent.ts', import.meta.url), 'utf8')
  )
  expect(source).toContain('Analytics methodology')
  expect(source).toContain('own baselines')
})
```

  (If `agent.test.ts` already exports or inspects the prompt directly, assert on that instead of reading the source file.)
- [ ] Run, expect failure: `npx vitest run src/main/agent.test.ts --maxWorkers=2`
- [ ] Append this block to `AXIVALE_SYSTEM_PROMPT` in `src/main/agent.ts` (before the final "Keep replies concise" bullet):

```text
- Analytics methodology (axibridge_* tools): ground every claim in tool
  output — never invent numbers. Compare players and squads against their OWN
  baselines (earlier runs/ranges via axibridge_compare and
  axibridge_player_stats), not against invented community benchmarks. Name the
  metric behind every improvement suggestion ("cleanses per run fell from 240
  to 90"), and say which runs it came from. When runs were skipped
  (skippedRuns in tool output), say so — never present partial data as
  complete. Prefer charts (axibridge_render_chart, axibridge_compare) for
  trends over time and tables for rosters and per-player breakdowns. Raw
  report JSON is never available to you; work only with the aggregates the
  tools return.
```

- [ ] Run, expect pass: `npx vitest run src/main/agent.test.ts --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: analytics-methodology section in the system prompt"`

---

## Task 12: Settings UI (repo links + PAT + health) and main-process wiring (axivale repo)

**Files:**
- Modify: `src/main/index.ts:57-107` (construct cache/client/service; extend `toolDeps`), `:125-145` (new IPC handlers)
- Modify: `src/preload/index.ts` and `src/preload/index.d.ts` (expose `axibridgeRepos*` and `axibridgeStatus`)
- Modify: `src/renderer/src/components/Settings.tsx` (new "AxiBridge report repos" sgroup between the AxiTools and About groups, `:592-593`)

### Steps

- [ ] Main wiring in `src/main/index.ts` (inside `app.whenReady`, after `buildGw2`):

```ts
  const axibridgeCache = new AxibridgeCache({
    dir: join(app.getPath('userData'), 'axibridge-cache'),
    capBytes: Number(store.getSetting('axibridgeCacheCapBytes')) || DEFAULT_CACHE_CAP_BYTES,
    ttlMs: META_TTL_MS
  })
  const buildAxibridge = (): AxibridgeService =>
    new AxibridgeService({
      repos: () => listLinkedRepos(store.getSetting('axibridgeRepos')),
      client: new AxibridgeClient(() => store.getActiveKey('github')),
      cache: axibridgeCache,
      summarize: summarizeInWorker,
      onProgress: (message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('axibridge:fetch-progress', { message })
        }
      }
    })
```

  Imports: `AxibridgeCache, DEFAULT_CACHE_CAP_BYTES, META_TTL_MS` from `./axibridgeCache`; `AxibridgeClient` from `./axibridgeClient`; `AxibridgeService` from `./axibridgeService`; `summarizeInWorker` from `./axibridgeSummarize`; `listLinkedRepos, serializeLinkedRepos, parseRepoRef` from `./axibridgeRepos`.
  Extend the `AgentService` `toolDeps` factory with `axibridge: buildAxibridge`.
  Add IPC handlers next to the existing `settings:*` block:

```ts
  ipcMain.handle('axibridge:repos-list', () => listLinkedRepos(store.getSetting('axibridgeRepos')))
  ipcMain.handle('axibridge:repos-add', (_event, input: string) => {
    const ref = parseRepoRef(input)
    if (!ref) return { ok: false, error: 'Enter owner/repo or a GitHub Pages URL (https://owner.github.io/repo).' }
    const repos = listLinkedRepos(store.getSetting('axibridgeRepos')).filter(
      (r) => !(r.owner === ref.owner && r.repo === ref.repo)
    )
    repos.push(ref)
    store.setSetting('axibridgeRepos', serializeLinkedRepos(repos))
    return { ok: true, repos }
  })
  ipcMain.handle('axibridge:repos-remove', (_event, owner: string, repo: string) => {
    const repos = listLinkedRepos(store.getSetting('axibridgeRepos')).filter(
      (r) => !(r.owner === owner && r.repo === repo)
    )
    store.setSetting('axibridgeRepos', serializeLinkedRepos(repos))
    return repos
  })
  ipcMain.handle('axibridge:status', async () => {
    try {
      return { ok: true, ...(await buildAxibridge().reposStatus()) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
```

- [ ] Preload (`src/preload/index.ts`, inside the `officer` object — follow the existing one-liner style):

```ts
  axibridgeReposList: () => ipcRenderer.invoke('axibridge:repos-list'),
  axibridgeReposAdd: (input: string) => ipcRenderer.invoke('axibridge:repos-add', input),
  axibridgeReposRemove: (owner: string, repo: string) => ipcRenderer.invoke('axibridge:repos-remove', owner, repo),
  axibridgeStatus: () => ipcRenderer.invoke('axibridge:status'),
```

  Mirror the signatures in `src/preload/index.d.ts`. The PAT keyring needs **no new preload methods** — `listKeys('github')`, `addKey('github', …)`, `removeKey`, `setActiveKey` already take a service string.
- [ ] Settings UI: add to `Settings.tsx` state + a new section. State:

```tsx
  // AxiBridge
  const [bridgeRepos, setBridgeRepos] = useState<Array<{ owner: string; repo: string }>>([])
  const [bridgeInput, setBridgeInput] = useState('')
  const [bridgeStatus, setBridgeStatus] = useState<{ msg: string; ok: boolean } | null>(null)
  const [bridgeHealth, setBridgeHealth] = useState<
    Array<{ repo: string; runs: number; lastRun: string | null; cachedReports: number; lastIndexFetch: number | null; error: string | null }>
  >([])
  const [githubKeys, setGithubKeys] = useState<KeyLabel[]>([])
  const [ghLabel, setGhLabel] = useState('')
  const [ghKey, setGhKey] = useState('')
```

  Load in the mount effect: `setBridgeRepos(await window.officer.axibridgeReposList())` and add `setGithubKeys(await window.officer.listKeys('github'))` to `refreshKeyLists()`. Handlers:

```tsx
  async function refreshBridgeHealth(): Promise<void> {
    const res = await window.officer.axibridgeStatus()
    if (res.ok) setBridgeHealth(res.repos)
  }

  async function addBridgeRepo(): Promise<void> {
    const res = await window.officer.axibridgeReposAdd(bridgeInput)
    if (!res.ok) {
      setBridgeStatus({ msg: res.error ?? 'invalid repo', ok: false })
      return
    }
    setBridgeRepos(res.repos)
    setBridgeInput('')
    setBridgeStatus({ msg: 'repo linked', ok: true })
    await refreshBridgeHealth()
    onChanged()
  }

  async function removeBridgeRepo(owner: string, repo: string): Promise<void> {
    setBridgeRepos(await window.officer.axibridgeReposRemove(owner, repo))
    onChanged()
  }
```

  JSX section (insert before the About sgroup):

```tsx
      <div className="sgroup">
        <h2>AxiBridge report repos</h2>
        {bridgeRepos.length > 0 && (
          <div className="picker">
            {bridgeRepos.map((r) => {
              const health = bridgeHealth.find((h) => h.repo === `${r.owner}/${r.repo}`)
              return (
                <button key={`${r.owner}/${r.repo}`} className="pi">
                  {r.owner}/{r.repo}
                  {health && !health.error && (
                    <span className="lead"> · {health.runs} runs · {health.cachedReports} cached</span>
                  )}
                  {health?.error && <span className="lead"> · unreachable</span>}
                  <span
                    className="kx"
                    title={`Unlink ${r.owner}/${r.repo}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeBridgeRepo(r.owner, r.repo)
                    }}
                  >
                    ✕
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <label className="slabel">Link a repo</label>
        <input
          className="sinput"
          type="text"
          value={bridgeInput}
          placeholder="owner/repo or https://owner.github.io/repo"
          onChange={(e) => setBridgeInput(e.target.value)}
        />
        <div className="srow">
          <button className="sbtn" disabled={!bridgeInput.trim()} onClick={addBridgeRepo}>
            Link repo
          </button>
          <button className="sbtn out" onClick={refreshBridgeHealth}>
            Check health
          </button>
        </div>
        {bridgeStatus && (
          <div className={`sstatus ${bridgeStatus.ok ? 'ok' : 'err'}`}>{bridgeStatus.msg}</div>
        )}
        <label className="slabel">GitHub token (optional — private repos / rate limits)</label>
        <Keyring
          keys={githubKeys}
          onActivate={(label) => activateLlmKey('github' as never, label)}
          onRemove={(label) => removeLlmKey('github' as never, label)}
        />
        <input
          className="sinput"
          type="text"
          value={ghLabel}
          placeholder="label, e.g. guild bot"
          onChange={(e) => setGhLabel(e.target.value)}
        />
        <input
          className="sinput"
          type="password"
          value={ghKey}
          placeholder="paste a fine-grained PAT with contents:read"
          onChange={(e) => setGhKey(e.target.value)}
        />
        <div className="srow">
          <button
            className="sbtn"
            disabled={!ghKey}
            onClick={async () => {
              await window.officer.addKey('github', ghLabel.trim() || 'unnamed', ghKey)
              setGhLabel('')
              setGhKey('')
              await refreshKeyLists()
              onChanged()
            }}
          >
            Add token
          </button>
        </div>
        <p className="shelp">
          Public report repos work without a token. Add one for private repos or if you hit
          GitHub rate limits.
        </p>
      </div>
```

  (Generalize `activateLlmKey`/`removeLlmKey` parameter types from `'gemini' | 'openai'` to `KeyService`-style strings instead of the `as never` casts — small signature widening in the same file.)
- [ ] Verify: `npm run typecheck && npx vitest run --maxWorkers=2`
- [ ] Commit: `git add -A && git commit -m "feat: AxiBridge repo links + GitHub PAT in Settings, service wiring + progress events"`

---

## Task 13 (trailing): display payload wiring + full verification

**Files:**
- Possibly modify: `src/main/providers/types.ts` (`AgentEvent` tool-result variant), `src/renderer/src/components/Article.tsx` / the tool-coupon component (whichever the rendering plan introduced)

### Steps

- [ ] Check whether the inline rich-rendering mechanism from the sibling plan (`display` on the `tool-result` `AgentEvent`, chart/table blocks in the tool coupon) is merged: `grep -rn "display" src/main/providers/types.ts src/renderer/src/components/`.
  - **If merged:** verify the provider adapters forward the `display` property from the MCP tool result into the `tool-result` event (the property already rides on every `okWith` result from Task 10). Add a forwarding line if the Claude adapter strips unknown result fields, and confirm one end-to-end render manually (ask "show attendance" in dev).
  - **If not merged:** nothing to do — tools already return compact JSON; the `display` property is inert until that plan lands. Note this in the final report.
- [ ] Full verification, both repos:
  - axivale: `npm run typecheck && npx vitest run --maxWorkers=2 && npm run build`
  - axibridge: `npm run typecheck && npx vitest run --maxWorkers=2 && npx vitest run --config packages/bridge-metrics/vitest.config.ts --root packages/bridge-metrics --maxWorkers=2`
- [ ] Manual end-to-end smoke (documented): link a real report repo in Settings, ask "who led the most fights this month?" and "compare last Friday's run to the one before" — confirm progress messages, table/chart payloads in tool results, and that re-asking does not re-download (cache hit).
- [ ] Commit any wiring: `git add -A && git commit -m "chore: display payload forwarding + end-to-end verification for axibridge analytics"`

---

## Error-handling coverage map (spec table → tasks)

| Failure | Where implemented / tested |
|---|---|
| Repo unreachable / 404 | Task 6 (`AxibridgeError 'not-found'` naming the repo), Task 9 (`runsList`/`reposStatus` isolate per-repo errors — test "one broken repo does not break the others") |
| Rate limited (anonymous) | Task 6 (`'rate-limited'` message suggests adding a PAT in Settings; test asserts the message) |
| Mid-stream download failure | Task 7 (`downloadReport`: partial chunks discarded, retry ×3 with 500 ms exponential backoff, final `'network'` error; stub-server test) |
| `rollup.json` absent | Task 9 (`rollupFor`: `extractRollupSource` + `buildRollupData` over cached reports; test asserts `rollupSource: 'computed-locally'`) |
| Cache cap hit | Task 7 (LRU eviction of reports only; summaries survive — tested) |
| Mixed-version schemas | Task 3 (`extractRunSummary` tolerates missing tables, `ReportSchemaError` for non-reports) + Task 8/9/10 (`skippedRuns` with reasons surfaced in every tool result — never silent drops) |

## Out of scope (phase 2 — do NOT implement)

GitHub device-flow OAuth, repo auto-discovery, AxiBridge local API / `local-api.json` discovery file, "current session" tools, auto-spawn via `axiAppLauncher`, writes to report repos, R2 replay data.
