# WvW Comp Playbook — Design

**Status:** Draft (design)
**Date:** 2026-06-15
**Builds on:** WvW Comp Expertise (`2026-06-15-wvw-comp-expertise-design.md`, now merged), the meta pipeline (`metaStore`, `metaPrompt`, `meta/refresh`), and the existing AxiBridge integration (`axibridgeClient`, `axibridgeService`).

## Goal

Give AxiVale a **curated, multi-factor "comp playbook"** per game mode that the agent
treats as top-priority ground truth when building or critiquing WvW squad comps.
The shipped comp-expertise feature gets the *structure* right (WvW-not-PvE framing,
role coverage, subgroup logic) but lacks current-meta **nuance**: it recommended
core Necromancer + Harbinger (the DPS tier list's lens) when the actual played meta
is Reaper-primary with a support-heavy, ~2-stab/1-cleanse subgroup shape. The
nuance lives in (a) what the guild actually runs and (b) expert iteration logic —
neither of which the scraped build guides capture.

**North star (do not lose this):** the goal is *"a solid baseline for people to
iterate with,"* NOT a bot that generates meta-breaking optimal comps. The playbook
produces a defensible current baseline plus the principles to iterate from; the
agent explains tradeoffs and invites iteration, and never claims optimality.

WvW first. Other modes can grow playbooks later; nothing here is WvW-hardcoded
except the seeded content.

## Why a playbook (and why multi-factor)

A single canonical "meta comp" source does not exist — comps are guild-specific and
shift every patch. So ground truth is assembled from factors, each with a distinct
trust character, and curated by an expert (the user):

- **Factor 1 — Derived baseline (this spec's core).** A rollup of the guild's own
  recent AxiBridge fight reports (last 30 days): profession mix, support ratio, and
  the modal subgroup template. This is what the guild *actually runs*, auto-fresh as
  the meta moves. Designed to consume a *pool* of reports so donated/centralized
  reports extend it later with no rearchitecture.
- **Factor 2 — Curated principles.** Hand-maintained expert iteration logic,
  attributed. Seeded from a top comp-maker's heuristics (see "Seeded principles").
- **Factor 3 — Overrides + scraped guides.** The user's free-form overrides, plus
  the existing scraped Layer 1/2/3 meta summary as supporting context.

The playbook is the **blessed synthesis** of these, surfaced to the prompt.

## Validation: the derived baseline works

A throwaway rollup of 20 WvW zerg reports (last 30 days) from two AxiBridge repos
produced exactly the nuance the model was missing — confirming Factor 1 is the right
primary source:

- Squad ~36 avg; **support ratio 49%** (genuinely support-heavy).
- Always-present core per squad: **Troubadour 7.7, Firebrand 7.5, Druid 6.2, Reaper 6.0.**
- Modal subgroup: **Troubadour + Firebrand + Druid (3 supports) + Reaper + 1 flex**
  (Specter / Berserker / Amalgam / Tempest), with **Luminary** as the FB alternative.
- **Reaper dominant (100%), Scourge situational (45%), core Necromancer absent
  (10%), Harbinger minor (35%)** — the exact inverse of what the model recommended.

## Seeded principles (Factor 2, from Veridian [rdux], top comp-maker)

Stored as the WvW playbook's initial `principles` text, attributed:

- **~2 stability supports per subgroup is normal** (NOT wasteful — this corrects a
  shipped `comp_check` rule).
- **≥1 cleanse support required per subgroup.**
- **Normal comp = reliable boon-rip + reliable burst, at ~2:1 boon-rip : burst DPS**
  (up to 3:1 depending on comp / damage rate).
- **Outlier-stacking:** when a build is a broken outlier, stacking it can *be* the
  comp (all-Untamed, Soulbeast stacks) — rules bend to outliers.
- The meta is **iteration-heavy**; output is a baseline to refine, not gospel.

## Architecture

All main-process except the Meta panel. Layers onto the existing meta + axibridge
infrastructure; no rearchitecture.

```
AxiBridge reports (linked repos; later: donated pool)
   └─ axibridgeClient.fetchIndex/fetchReport (existing) ──► compDerive (NEW, pure)
                                                              └─► DerivedComp
Playbook store (NEW fields on MetaMode, sticky):
   { derived: DerivedComp|null, derivedAt, principles, overrides, blessed }
   • recordDistill (existing) touches ONLY `notes` — never the playbook
   • recordDerivedComp(modeId, derived)         ← from a derivation run
   • updatePlaybook(modeId, {principles?, overrides?, blessed?})  ← from UI

AI turn:  buildMetaReference + buildPlaybookReference(modes) → system prompt
          (blessed playbooks injected as top-priority "baseline to iterate")
          comp_check (updated rules) validates the model's draft

Meta panel: view derived baseline · edit principles/overrides · Refresh · Bless
```

### Components (each isolated + testable)

1. **`compDerive`** (`src/main/meta/compDerive.ts`) — PURE aggregator. Input: an
   array of report objects (the `stats.squadClassData`, `stats.roleClassifications`,
   `stats.squadCompByFight` slices) + provenance (repos, window). Output `DerivedComp`:
   ```ts
   interface DerivedComp {
     window: { fromISO: string; toISO: string; days: number }
     sampleSize: number          // # reports
     sourceRepos: string[]       // provenance, e.g. ["Fibbs23/Agg-Report", ...]
     lowConfidence: boolean      // sampleSize < MIN_SAMPLE (3)
     avgSquadSize: number
     supportPct: number          // 0–100, from roleClassifications
     professions: Array<{ name: string; avgPerSquad: number; presencePct: number; runAs: 'support' | 'damage' | 'mixed' }>
     subgroup: { core: string[]; flex: string[] }  // core = prof in ≥50% of 5-player parties; rest = flex
   }
   ```
   No I/O — fully fixture-testable on captured report JSON.

2. **Derivation runner** (`src/main/meta/deriveComp.ts` or a method on the axibridge
   service) — uses the EXISTING `axibridgeClient.fetchIndex` + `fetchReport` over the
   linked repos, filters index entries to the last 30 days, fetches those reports,
   passes the comp slices to `compDerive`, and calls `store.recordDerivedComp`.
   Error-isolated: a failed repo/report is skipped; zero reports → no update (never
   wipes a prior derived comp or the curation).

3. **Playbook store** — extend `MetaMode` with an optional `playbook` object and add
   store methods. `recordDistill` (build-summary refresh) is unchanged and never
   touches `playbook` (stickiness). `recordDerivedComp` sets `derived`/`derivedAt`
   only. `updatePlaybook` patches `principles`/`overrides`/`blessed`. The WvW seed in
   `DEFAULT_SEED` ships `playbook.principles` pre-filled with the seeded principles
   and `blessed: true` so the principles are live before any derivation/UICuration.

4. **Prompt surfacing** (`buildPlaybookReference` in `metaPrompt.ts`, appended in
   `agent.ts` next to `buildMetaReference`). For each mode whose `playbook.blessed`
   is true, inject a block titled e.g. *"WvW comp playbook — guild baseline (a
   starting point to iterate, NOT an optimal comp)"* containing: provenance line
   (sample size, date range, repos; flag `lowConfidence`), the derived baseline
   (squad size, support%, core builds w/ counts, modal subgroup + flex), the
   principles, and overrides. Instructions: build from this baseline, apply the
   principles, **prefer these builds over the DPS tier list**, explain tradeoffs and
   invite iteration, never claim optimal. Unblessed playbooks are NOT surfaced.

5. **`comp_check` rule fix** (`src/main/meta/compCheck.ts`) — align to the expert
   heuristics:
   - **Remove** the "doubles Primary Support → wasteful" warning (≥2 stab is normal).
   - **Add** a per-subgroup cleanse check: a valid (non-empty, ≤5) subgroup with no
     cleanse provider → warning ("no cleanse support — ≥1 per subgroup expected").
   - Keep: per-subgroup stability presence for DPS subgroups, squad-wide strip
     presence, oversized/empty/unknown-role handling.
   - The 2:1 boon-rip:burst ratio stays a *principle* (prose the model applies), not
     brittle validator math. Update `compRoles` mapping/eval set as needed.

6. **Meta panel UI** (`src/renderer/src/components/panels/Meta.tsx` + IPC). Per mode,
   a Playbook section: render the derived baseline (table + subgroup) with provenance;
   editable `principles` and `overrides`; a **Refresh from AxiBridge** action; a
   **Bless** toggle. New IPC: `meta:derive-comp` (run derivation) and
   `meta:update-playbook` (patch principles/overrides/blessed).

## Data flow

1. User links AxiBridge repos (existing setting). In the Meta panel, **Refresh from
   AxiBridge** → derivation runner pulls last-30-day reports → `compDerive` →
   `recordDerivedComp`. (Background auto-derivation deferred.)
2. User reviews the derived baseline, edits principles/overrides, **Blesses** it.
3. On each AI turn, `buildPlaybookReference` injects the blessed WvW playbook as
   top-priority ground truth.
4. Model drafts a WvW comp *from the baseline + principles*, calls `comp_check`
   (updated rules), fixes errors, and presents it framed as a baseline to iterate —
   citing the guild reports and the principles.

## Error handling

- No linked repos / no reports in window → derivation no-ops with a clear status;
  the playbook still surfaces its principles/overrides. Never blocks a turn.
- A report missing the comp slices (older format) is skipped; `sampleSize` reflects
  only usable reports; `lowConfidence` flags thin samples.
- `recordDistill` must never overwrite `playbook` (regression-tested).
- Derivation failure leaves the prior `derived` intact (knowledge never regresses).

## Testing

- **`compDerive`** unit tests on captured report fixtures: profession avg/presence,
  support%, core/flex subgroup split, `lowConfidence` threshold, empty input.
- **Store**: `recordDistill` does not touch `playbook`; `recordDerivedComp` sets only
  derived fields; `updatePlaybook` patches curation; WvW seed has principles + blessed.
- **`buildPlaybookReference`**: blessed → block present with provenance + principles;
  unblessed → absent; lowConfidence surfaced.
- **`comp_check`**: doubling warning gone; per-subgroup missing-cleanse warning
  present; existing checks intact; eval set updated.
- **Derivation runner**: integration test with a fake axibridge client over fixtures
  (window filter, repo isolation, zero-report no-op).
- Vitest `--maxWorkers=2`.

## Phasing

- **Phase A — Brain (backend).** `compDerive`, playbook store fields + methods +
  seeded WvW principles, `buildPlaybookReference` + prompt wiring, `comp_check` fix +
  eval update. Delivers value immediately: principles go live (blessed seed), and the
  model stops recommending core necro once a derivation runs.
- **Phase B — Curation surface.** Derivation runner wired to IPC, Meta-panel Playbook
  UI (view/edit/refresh/bless).
- **Deferred (later sub-projects):** background auto-derivation on a schedule; the
  crowdsourced/centralized donated-report pool (compDerive already consumes a pool, so
  this is a data-source addition, not a redesign).

## Non-goals

- An optimal/meta-breaking comp generator (explicitly — baseline to iterate only).
- PvE/PvP playbooks (WvW first; structure is mode-generic).
- Hard validator math for the 2:1 rip:burst ratio (kept as a principle).
- The donated-report ingestion/centralization pipeline (deferred).
- Fine-tuning any model.
