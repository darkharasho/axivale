# Lightweight Evals for AxiVale — Design

**Date:** 2026-06-17
**Status:** Approved (design), pending spec review

## Problem

AxiVale leans on an LLM for extraction/classification (build/gear parsing, source
labeling, comp structure). The recurring bugs in `TODO.md` are exactly these failure
modes — e.g. source mislabeling (`DPS Berserker` attributed to the wrong gw2mists
build), gear not extracted from a snippet, comp structure misunderstood. There is one
`*.eval.test.ts` today, but it is really a deterministic unit test. We want a
**lightweight** eval layer that catches regressions in these behaviors without adding a
new framework or making normal CI slow/expensive/flaky.

## Goals

- Catch regressions in three areas: **(1) source labeling**, **(3) gear/build
  extraction**, **(4) comp structure**.
- Stay inside the existing vitest setup — an "eval" is a `*.eval.test.ts` file plus a
  fixture corpus and assertion-based grading.
- Default runs are **offline, deterministic, free** (replay recorded fixtures). Real
  model calls are **opt-in** only.
- Grading is **assertion-based** — no LLM-as-judge.

## Non-goals

- No game-mode-bleed (#2) or entity-resolution (#5) evals in this first cut. #2 needs
  multi-turn conversation fixtures (more setup); #5 is already well unit-tested.
- No new test runner, no judge model, no live calls in `npm test`/CI by default.

## The split

Only **#1 is a true LLM eval.** #3 and #4 are deterministic corpus tests. This is the
honest scope and the reason it stays lightweight.

| # | Area | Category | Model? | Mechanism |
|---|------|----------|--------|-----------|
| 1 | Source labeling | A: LLM-quality | yes | `distill()` with a recorded/live `MetaModel`; grade output text |
| 3 | Gear/build extraction | B: deterministic | no | captured HTML corpus → `scrapeBuildGear` / `parseMetabattleSlots`; grade parsed gear |
| 4 | Comp structure | B: deterministic | no | extend existing `compCheck.eval.test.ts` corpus |

This works because the production code is already dependency-injectable:
- `distill(mode, excerpts, model, specMap, today)` takes `model: MetaModel =
  (prompt) => Promise<string>` (`src/main/meta/distill.ts`).
- `scrapeBuildGear(html, profession, fetchImpl)` takes an injectable `fetchImpl`, and
  `parseMetabattleSlots(html)` is pure (`src/main/meta/buildGear.ts`).
- `checkComp(roster)` is pure (`src/main/meta/compCheck.ts`).

No production refactor is required.

## Layout

```
src/main/meta/__evals__/
  harness.ts                       # fixtureModel(), liveModel(), loadFixture(), grading helpers
  source-labeling/
    cases.ts                       # case defs: excerpts in + expectations
    fixtures/<caseId>.json         # recorded model output, one per case
  gear/
    cases.ts                       # html ref + expected parsed gear
    fixtures/<caseId>.html         # captured MetaBattle/Snowcrows snippets
src/main/meta/sourceLabeling.eval.test.ts   # iterates source-labeling cases
src/main/meta/gearExtraction.eval.test.ts   # iterates gear cases
src/main/meta/compCheck.eval.test.ts        # existing; lightly expanded
```

Naming stays `*.eval.test.ts` so the existing vitest `include`
(`src/**/*.test.{ts,tsx}`) picks them up automatically — in replay mode they are safe,
fast, and deterministic, so they belong in normal CI.

## Harness (`__evals__/harness.ts`)

Small, no dependencies beyond vitest + node fs.

- `fixtureModel(caseId): MetaModel` — returns a `MetaModel`:
  - **replay** (default): returns the recorded fixture string for `caseId`. If the
    fixture is missing, the test fails with a clear "run eval:record" message.
  - **live** (`EVAL_LIVE=1`): calls the real model via `liveModel()` (does not write
    fixtures).
  - **record** (`EVAL_RECORD=1`): calls `liveModel()` **and** rewrites
    `fixtures/<caseId>.json`.
- `liveModel(): MetaModel` — **wired to app config** (see next section).
- Grading helpers — thin wrappers over `expect`, e.g.:
  - `sourceDomainOf(line: string): string | null`
  - `expectBuildAttributedTo(notes, buildName, domain)`
  - `expectGearContains(gear, stat | rune | sigil)`
  These keep failure messages readable and assertions declarative in the case files.

A case definition is plain data, e.g. for source labeling:

```ts
{
  id: 'gw2mists-dps-warrior',
  excerpts: [{ source: 'gw2mists — "DPS Warrior"', text: '...captured snippet...' }],
  expect: { build: /Berserker/i, domain: 'gw2mists.com', noPveSpecs: true }
}
```

The `.eval.test.ts` file is a thin loop: `for (const c of cases) it(c.id, ...)`.

## Live mode — wired to app config

The production `MetaModel` is built in `src/main/index.ts` from:
- `SettingsStore` (`settings.json` in Electron `userData`, decrypted via
  `electronCipher()` / `safeStorage`) — provider selection + per-provider model
  (`PROVIDER_MODEL_SETTING`).
- `runClaudeOnce(prompt, cfg)` in `src/main/meta/model.ts` (the meta refresher currently
  pins `claude-sonnet-4-6` for faithful spec-name copying).

`liveModel()` resolves the **same source of truth**:

1. Read `settings.json` from `userData` to get the active provider + model (same keys the
   app uses). `EVAL_PROVIDER` / `EVAL_MODEL` env vars override for ad-hoc runs.
2. Build the one-shot model via the existing provider one-shot path
   (`runClaudeOnce` for Claude; analogous one-shot for other providers as needed —
   Claude is the only one the meta refresher uses today, so Claude is the only live path
   implemented in this cut).
3. **Credential:** the stored OAuth token is encrypted with Electron `safeStorage`, which
   is unavailable in a headless vitest/node process. So the credential is read from an
   env var (`CLAUDE_CODE_OAUTH_TOKEN` / provider-appropriate) when `safeStorage` can't
   decrypt. Provider and model still come from app config; only the secret falls back to
   env. This keeps "wired to app config" true (same provider/model/source-of-truth) while
   remaining runnable headless.

Live mode is never reached under plain `npm test` (no `EVAL_LIVE`/`EVAL_RECORD`), so a
missing token never breaks CI.

## How it runs

- `npm test` → eval tests run in **replay** mode. Deterministic, free. Catches
  parser/grader/fixture regressions and `checkComp` logic regressions.
- `npm run eval` → `EVAL_LIVE=1 vitest run src/main/meta/*.eval.test.ts` — hits the real
  model (resolved from app config). Truest signal; run manually before releases.
- `npm run eval:record` → `EVAL_RECORD=1 vitest run src/main/meta/*.eval.test.ts` —
  refresh fixtures from live, then `git diff` shows model drift for review before commit.

Three new `package.json` scripts: `eval`, `eval:record`. (`eval` and `eval:record` set
the env var and target the eval glob.)

## Seed corpus (first cut)

- **Source labeling** (#1): start with the known `gw2mists "DPS Warrior" → Berserker`
  case from `TODO.md`, plus 2–3 more drawn from real captured excerpts (multi-source vs
  single-source attribution). Each gets a recorded fixture.
- **Gear extraction** (#3): capture 2–3 real HTML snippets (MetaBattle armory + at least
  one Snowcrows) into `gear/fixtures/`, assert key stats/runes/sigils/weapons parse.
- **Comp structure** (#4): extend the existing 3 cases with a few more boundary cases
  (missing strip, missing cleanse, exactly-5 vs 6, flex slot present).

## Testing the harness itself

The harness is plain code, so it gets ordinary unit coverage: `fixtureModel` returns the
recorded string in replay mode; missing-fixture path fails loudly; grading helpers
(`sourceDomainOf`, `expectGearContains`) behave on known inputs. No live calls in these.

## Risks / open considerations

- **Fixture staleness:** recorded fixtures only re-test the model when re-recorded. This
  is accepted — `eval:record` + the `eval` live mode exist precisely to surface drift on
  demand. Replay guards the *parser/grader*, not live model quality.
- **Snippet capture:** gear/source fixtures are captured HTML/text; they should be
  trimmed to the relevant region to keep fixtures small and readable.
- **Provider breadth:** only Claude's live path is implemented now (it's the only one the
  meta refresher uses). Other providers can be added to `liveModel()` later without
  changing the harness shape.
```
