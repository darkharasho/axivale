# Ship `@axiapps/*` shared packages to npm — Design

**Date:** 2026-06-13
**Status:** Approved for planning
**Repos touched:** `axiforge` (forge-render, gw2-data packages), `axibridge` (bridge-metrics package), `axivale` (consumer deps + CI)

## Goal

Replace the fragile `file:`-path sharing of `@axiapps/*` packages with real published npm packages, so axivale and axibridge production builds and CI pass without sibling checkouts or build-on-install. This is the robust fix for the two release-blocking failures below.

## Context — the failures and the npm reality

**Release failures (this session):**
1. **axibridge build** — `getFightOutcome is not exported by computePlayerAggregation.ts`. The bridge-metrics package builds to **CJS only**; the `export * from '@axiapps/bridge-metrics/…'` shims can't expose named exports to rollup's static analysis. (`vitest` passes via runtime CJS interop; the real rollup build does not.)
2. **axivale `npm ci`** — installing the `@axiapps/bridge-metrics` `file:` dep runs its `prepare: tsc`, but `tsc: command not found` on a clean runner (npm doesn't install a linked package's devDeps). Also: axivale resolves all three `@axiapps/*` via `file:../axiforge|axibridge/...`, requiring sibling checkouts in CI.

**npm state (verified):**
- The `@axiapps` scope exists and publishes **public** packages. `@axiapps/gw2-data@0.1.1` is already published (public, CJS). `gw2-class-icons@0.3.0` is on npm.
- `@axiapps/forge-render` and `@axiapps/bridge-metrics` are **not** published.
- This environment is **not** logged into npm — the user runs `npm publish` (decision below).

## Decisions (from brainstorming)

1. **Publish `@axiapps/*` to npm as public packages**; consumers depend on `^` versions instead of `file:` paths. Public → no auth token needed for consumer installs.
2. **User runs `npm publish --access public` locally** (they're logged in); this spec prepares the packages and hands over exact commands.
3. **bridge-metrics → dual ESM + CJS build** (the single fix that satisfies rollup ESM named exports, node/worker ESM, and the metrics-audit `require()`).
4. **forge-render** publishes as-is (ESM + `?raw` SVG imports — all consumers are Vite/electron-vite); its `@axiapps/gw2-data` dep changes from `file:` to the published `^` version.
5. **gw2-data** stays as published (0.1.1); republish with a patch bump **only if** the in-repo source diverged from npm 0.1.1.

## Architecture

### Package: `@axiapps/bridge-metrics` (axibridge/packages/bridge-metrics)
- **Dual build** with `tsup` (add as devDep): emits `dist/*.js` (ESM) + `dist/*.cjs` (CJS) + `dist/*.d.ts` for the entry and each subpath module currently exposed (index + the per-metric modules: combatMetrics, conditionsMetrics, dashboardMetrics, computePlayerAggregation, rollup, reportMetrics, metricsSettings, etc. — whatever the `exports`/shims reference).
- **`exports` map** per subpath: `{ "types": "./dist/<m>.d.ts", "import": "./dist/<m>.js", "require": "./dist/<m>.cjs" }`, plus `"."`. `"type": "module"` with `.cjs` for the CJS condition.
- `"files": ["dist"]`, `"publishConfig": { "access": "public" }`, `"prepublishOnly": "tsup"` (or `npm run build`). Keep a `build` script (`tsup`) for local/CI. The old `prepare: tsc` is replaced by the dual build; consumers no longer build it (they get prebuilt dist from npm).
- Set an initial published version (e.g. `0.1.0`).

### Package: `@axiapps/forge-render` (axiforge/packages/forge-render)
- Change dependency `@axiapps/gw2-data` from `file:../gw2-data` → `^0.1.1` (published). Keep `gw2-class-icons: ^0.3.0` (already npm).
- Ensure `"files"` includes everything the published package needs: `src/**` (it ships ESM source), `*.css`, and any SVG/asset files the `?raw` imports reference. `"publishConfig": { "access": "public" }`. Confirm `exports` (`.` + `./forge-render.css`) resolve from `src`.
- Publish at its current `0.1.0`.

### Package: `@axiapps/gw2-data` (axiforge/packages/gw2-data)
- Diff the in-repo source against published `0.1.1`. If identical → no change. If diverged → bump to `0.1.2`, `publishConfig.access public`, republish. (CJS stays — it's consumed by node and by forge-render; rollup's commonjs interop handles it, the existing "default not exported" warning is non-fatal.)

### Consumer: axibridge
- bridge-metrics is axibridge's **own workspace package**; axibridge keeps consuming it locally (workspace), now via the **dual build** → rollup resolves named exports → the `getFightOutcome` build error is gone. The metrics-audit `createRequire` shims (added earlier) keep working via the CJS condition.
- No dependency-source change for axibridge (it owns the package); just the dual build + a build step before the electron build if not already present.

### Consumer: axivale
- Replace the three `file:` deps in `package.json` with published versions: `@axiapps/forge-render@^0.1.0`, `@axiapps/bridge-metrics@^0.1.0`, `@axiapps/gw2-data@^0.1.1`. `npm install` to refresh the lockfile.
- **Remove** the `axiforge`/`axibridge` sibling-checkout steps from `.github/workflows/release.yml` and `ci.yml` (keep `gw2-class-icons`? — it's now only a transitive dep of forge-render resolved from npm, so remove that checkout too). CI becomes a plain `npm ci`.
- Re-evaluate `electron.vite.config.ts` `optimizeDeps`: with gw2-data as a normal npm dep, the forced `include: ['@axiapps/gw2-data', ...]` hack is likely unnecessary; keep the `exclude: ['@axiapps/forge-render']` only if its `?raw` imports still require source-serving. Simplify to what the dev server actually needs (verified by `npm run dev` resolving cleanly).

## Sequencing (interleaves with the user's publish step)

1. **Prep (me):** bridge-metrics dual build + exports + version; forge-render gw2-data dep → `^0.1.1` + files/publishConfig; gw2-data diff (bump if needed). Verify each with `npm pack --dry-run` and a local ESM-import + `require()` smoke of bridge-metrics dist.
2. **Publish (user):** `npm publish --access public` in bridge-metrics, forge-render, and gw2-data (if bumped). I provide exact commands and the order (gw2-data first if bumped, then forge-render which depends on it, then bridge-metrics).
3. **Flip consumers (me):** axivale deps → published versions; `npm install`; remove sibling-checkout CI steps; simplify optimizeDeps. axibridge: confirm dual-build wiring + electron build passes.
4. **Re-release (me):** re-tag axivale `v0.3.0` and axibridge `v2.10.0` (or patch-bump) to re-trigger the release workflows; watch them to green.

## Error handling / verification

- Each package: `npm pack --dry-run` shows the intended files; bridge-metrics dist validated by both `import { getFightOutcome } from '…'` (ESM) and `require('…')` (CJS) returning the symbol.
- axibridge: `npm run build` (electron rollup) succeeds — the `getFightOutcome` error is gone; `npm run audit:metrics` + `test:unit` still green.
- axivale: from a clean state with **no sibling repos**, `npm ci` (pulling from npm) + `npm run build` + `npm run typecheck` + `vitest` all pass; `npm run dev` resolves.
- Releases: tag-triggered `release.yml` runs reach success for both repos.

## Testing

- bridge-metrics: existing vitest suite stays green against the dual build; a dual-format smoke test (ESM import + CJS require both expose the named API).
- axibridge: full `audit:metrics` / `audit:conditions:consistency` / `test:unit` green; electron build succeeds.
- axivale: full vitest + typecheck + build green with published deps and no sibling checkouts.

## Out of scope

- A CI publish workflow / NPM_TOKEN automation (user publishes locally; can be added later).
- Converting gw2-data to ESM/dual unless the diff shows divergence requires a republish (it's consumed fine as CJS).
- Republishing axiforge (already shipped v0.7.0 and unaffected — its packages live there but it consumes them internally and built fine).
