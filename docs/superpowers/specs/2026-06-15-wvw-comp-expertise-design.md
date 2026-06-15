# WvW Comp Expertise — Design

**Status:** Draft (design)
**Date:** 2026-06-15
**Builds on:** Meta RAG retrieval (`2026-06-14-meta-rag-retrieval-design.md`), GW2 meta fetch (`2026-06-14-gw2-meta-fetch-design.md`), and the meta-bias foundation (`2026-06-14-gw2-meta-bias-foundation-design.md`).

## Goal

Make AxiVale an expert at **WvW squad compositions**, not just individual builds.
Today the knowledge pipeline is build-centric: sources are distilled into tables
of *individual* builds (profession + elite spec + role + tier), retrieved via
`meta_search`. The only composition-level knowledge in the whole app is the
hardcoded 5-role subgroup skeleton in `AXIVALE_SYSTEM_PROMPT` (`agent.ts:28`).
The model therefore *improvises* squads from a generic skeleton plus a pile of
single builds — which is why comps are dicey while build ID and single-build
recommendations are solid.

WvW first. PvE-instanced and PvP-conquest comp expertise are explicitly **out of
scope** for this design (different comp theory; see Non-goals).

## The four failure modes this fixes

The user reports all four occur:

1. **Wrong role / boon coverage** — misses or doubles roles (no quickness, no
   stability, two healers where one is needed).
2. **Builds don't fit together** — individually-good builds that don't synergize
   as a squad.
3. **Wrong mode template** — applies a PvE 10-man frame (qu/alac-per-subgroup) to
   WvW, which doesn't run alacrity that way.
4. **Hallucinates / no source** — invents comp structures or cites builds that
   don't exist.

All four trace to one structural gap: **no composition-level ground truth.** Fix
the gap and all four improve.

## Why not fine-tune

Considered and rejected. The app's own system prompt already states the principle
("NEVER design a build from memory: GW2 balance patches invalidate your training
data"). The same applies to comps — WvW gets balance splits and patches every few
months. A fine-tuned model bakes in a snapshot that goes stale, cannot cite a live
source (so it does nothing for failure mode 4), and needs a dataset + infra we do
not have. Everything else in AxiVale is expert *because it retrieves fresh, sourced
knowledge.* Comps should work the same way. "Train" here means **give the system
real comp-level knowledge plus the ability to check its own work**, not change
model weights.

## Approach: knowledge layers + a deterministic validator (phased)

Two parts, shipped in two phases.

### Sourced truth comes in three layers

There is **no single canonical "here is the 50-man roster" page** — real comps are
guild-specific, so that does not exist as citeable truth. Instead, comp ground
truth decomposes into three layers, each with a distinct trust level and all
reachable by the existing scraper:

**Layer 3 — Mechanics truth (GW2 Wiki).** The hard numbers the validator anchors
on. Mode-agnostic game mechanics, so WvW-safe (unlike PvE's qu/alac pairing
convention).
- `https://wiki.guildwars2.com/wiki/Squad` — max 50, max 15 subgroups, 5 per subgroup.
- `https://wiki.guildwars2.com/wiki/Boon` — the **5-target boon cap** that is the
  entire reason subgroups exist.
- Uses the existing `wiki` source kind in `meta/sources.ts`.

**Layer 1 — Composition rules (WvW guide pages).** The role taxonomy and
subgroup/squad-wide requirements, in prose.
- `https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles` — role taxonomy
  (Primary/Secondary/Tertiary Support, Boon Strip DPS, Pure DPS), the boons each
  covers, subgroup config examples.
- `https://guildorder.com/games/gw2/guides/wvw-squad-leadership` — ball-group
  theory, squad scale (15–50), maintaining boon coverage on a moving zerg.
- These need a **new distill prompt** tuned to extract *comp rules* (role → boons,
  per-subgroup requirements, squad-wide ratios), not build tables.

**Layer 2 — Role-tagged meta builds (WvW build sites).** Which builds fill which
WvW role + tier. Mostly already scraped; we ensure each build carries its WvW role
label so it can be mapped to boons.
- `https://www.gw2mists.com/builds` (primary, WvW-only site)
- `https://metabattle.com/wiki/WvW` (build index by role)
- `https://snowcrows.com/builds/wvw`
- `https://snowcrows.com/news/wvw` — **crawl the landing page and follow the newest
  DPS tier-list link**; never pin a dated URL (the tier list rotates irregularly:
  Oct 2025 → Dec 2025 → Feb 2026 → May 2026, newest always at top). Uses the
  existing `linkSelector` + `crawlDepth` crawl mechanism.
- `https://guildjen.com/gw2-wvw-builds/` — **bonus:** per-build pages embed
  composition rules in prose (e.g. "most squads want each 5-man subgroup to have
  one Med Kit Scrapper or Frontline Aurashare Tempest"). The distill step for these
  pages should capture that "role-in-squad" sentence, not just the build's stats.

**Trust hierarchy:** wiki (mechanics) > WvW guides (rules) > build sites (role
choices). `comp_check`'s math cites the wiki; role/build choices cite the guides
and build sites. This separation keeps the validator defensible.

**Deliberately excluded** (recorded so we don't drift): SEO aggregator tier-lists
(AxeeTech, pecsandbox), single-comp forum posts, and video-only guides —
community-anecdotal or unscrapeable, exactly the input that breeds failure mode 4.

**Verbatim-name discipline applies unchanged.** Sources use post-training
elite-spec names (Evoker, Untamed, Amalgam, Conduit, Luminary, Spectre, Paragon,
Troubadour). The existing distill faithfulness rule (copy names verbatim, never
"correct" or reassign) carries over to the comp-rule distill prompt.

### `comp_check` — the deterministic validator (Phase 2)

A tool that turns "wrong coverage" and "builds don't fit" from vibes into
arithmetic. Given a proposed roster (builds assigned to subgroups), it:

1. Maps each build → WvW role → the boons/duties that role provides (from Layer 2
   role tags + Layer 1 role→boon mapping).
2. Checks **per-subgroup** coverage against Layer 1 rules: stability source
   present, boon support present for any pure-DPS subgroup, no wasted doubling.
3. Checks **squad-wide** counts: enough boon strip/corrupt, condition cleanse, and
   hard CC for the squad size.
4. Anchors target ratios on Layer 3 mechanics (5-target boon cap → why each
   subgroup needs its own support).
5. Returns gaps and doubles as structured findings the model then fixes.

Flow: **model proposes → `comp_check` does the math → model fixes and re-checks.**
The boon-cap and positioning facts ("stack within 300") are things the model
*cites*; coverage counting is what the validator *computes*.

## Architecture

Layered onto the existing meta-fetch + RAG pipeline (all main process). No
re-architecture.

```
background refresh (existing)
  └─ crawl source → pages[] ──┬─→ distill (builds)        → notes (build table)   (existing)
                              ├─→ distillComp (rule pages)→ notes (## Squad Composition section)  (NEW, Layer 1)
                              └─→ ingest → chunk → embed → LanceDB upsert (existing; rule pages indexed alongside build chunks, same WvW mode)

AI turn:
  meta_search(query, mode='WvW')          → existing hybrid retrieval (now includes comp-rule chunks)
  comp_check(roster)                       → role/boon math → gaps & doubles   (NEW, Phase 2)
```

### Components

1. **Source registrations** (`meta/sources.ts`). Add the Layer 1/2/3 URLs above.
   Wiki pages use `kind: 'wiki'`. The Snow Crows news landing uses a `linkSelector`
   targeting the latest tier-list article + `crawlDepth`. GuildJen WvW index keeps
   its existing `browser` config.

2. **Comp-rule distill** (`meta/distill.ts` or a sibling). A second distill prompt
   for guide/rule pages: extract role taxonomy, role→boon mapping, per-subgroup
   requirements, squad-wide ratios. Output appended to the mode's `notes` as a
   `## Squad Composition` section (single-notes-per-mode storage unchanged); the
   rule pages chunk into the RAG index alongside build chunks under the same `WvW`
   mode (no new chunk tag in Phase 1 — they retrieve by relevance). Reuses the
   model-injection + faithfulness pattern of the existing distill (missing model →
   null → previous knowledge preserved).

3. **Role→boon mapping.** A small, sourced lookup (derived from Layer 1) that
   `comp_check` uses to translate a build's WvW role into the boons/duties it
   covers. Lives next to the validator; every entry traces to a Layer 1 URL.

4. **`comp_check` tool** (Phase 2, in `tools/`). Pure function over a roster +
   the role→boon mapping + Layer 3 mechanics constants; returns structured
   findings. Registered in `buildOfficerTools`. No network — operates on data
   already retrieved.

5. **System prompt** (`agent.ts`). Replace the generic 5-role skeleton with a
   WvW-accurate framing that (a) points the model at `meta_search` for comp rules
   and `comp_check` for validation, and (b) states the propose→check→fix loop.
   Scale-aware (havoc / small zerg / full zerg), not a fixed 5-slot list.

## Data flow

1. Refresh crawls Layer 1/2/3 sources → comp-rule pages distilled to a `comp`
   summary + chunked into RAG; build pages unchanged.
2. User asks for a WvW comp. Model calls `meta_search(query, 'wvw')` → gets comp
   rules + role-tagged builds with sources.
3. Model drafts a roster, calls `comp_check(roster)`.
4. `comp_check` returns coverage gaps/doubles. Model revises, re-checks, then
   presents the comp with every build linked to its source and every rule cited.

## Error handling

- Any source failing to crawl is skipped, not errored (existing behavior); comp
  knowledge degrades gracefully to whatever distilled.
- `comp_check` on an unmappable build (no role tag) reports it as "unknown role —
  cannot verify coverage" rather than guessing — never silently passes.
- Distill model missing/failing → previous comp summary retained (knowledge never
  regresses), matching existing distill behavior.

## Testing

- **Unit:** comp-rule distill against fixture guide HTML (asserts role taxonomy +
  rules extracted, names verbatim). Role→boon mapping completeness. `comp_check`
  math against hand-built rosters (known gaps, known doubles, clean comp).
- **WvW comp eval set:** a small fixture set of known-good and known-bad WvW comps
  with expected `comp_check` verdicts, so "expert" is measurable, not a feeling.
  Run as a test; extend as failure modes surface.
- Vitest with `--maxWorkers=2` per repo convention.

## Phasing

- **Phase 1 — Knowledge.** Layer 1/2/3 source registrations + comp-rule distill +
  WvW system-prompt rewrite. Immediately improves failure
  modes 3 (mode template) and 4 (sourcing), and much of 1 (coverage) via better
  retrieval. Shippable on its own.
- **Phase 2 — Validator.** `comp_check` + role→boon mapping + eval set. Closes
  failure modes 1 and 2 with arithmetic.

## Non-goals

- PvE-instanced and PvP-conquest comp expertise (different theory; later
  sub-projects, each its own spec).
- Auto-generating a full named 50-man roster as canonical truth (doesn't exist as
  a source; the model composes from rules + builds and validates).
- Fine-tuning any model.
- Roster persistence / editing UI beyond what AxiForge comp tools already provide.
