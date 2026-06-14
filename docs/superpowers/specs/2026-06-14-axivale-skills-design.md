# AxiVale Skills — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

User-authored "skills" for AxiVale: named prompt recipes that make recurring,
open-ended asks produce consistent, structured answers. The motivating case —
"how did our raid go tonight?" — currently yields a wide variety of responses; a
**Raid Recap** skill turns it into the same well-shaped report every time. A
skill is a recipe (what data to pull, which tools to prefer, how to structure the
reply), matched automatically from natural language or invoked explicitly.

## Goals

- Let users define reusable recipes that shape the agent's output.
- Natural-language auto-matching ("how'd raid go?" → Raid Recap) **and** explicit
  invocation as a reliable override.
- Scale to a growing catalog without bloating every turn's context.
- Reuse existing patterns (stores, panels, tools, the agent turn pipeline).

## Non-goals

- Deterministic workflows / fixed tool sequences (skills are recipes the agent
  executes flexibly, not hard-coded macros).
- AI-assisted skill authoring (the agent creating/editing skills) — deferred;
  v1 is UI-authored only.
- Sharing/syncing skills between users.

## Core decisions

| Axis | Decision |
|------|----------|
| Triggering | **Both** — auto-match from natural language, plus explicit invocation (explicit wins) |
| Skill content | **Prompt recipe** — name + when-to-use + free-form instructions |
| Authoring | **UI panel** (create/edit/delete/enable); no agent-authoring in v1 |
| Matching | **Hybrid** — lightweight registry always injected; full recipe loaded on demand |

## Data model & storage

New `src/main/skillStore.ts` owns `skills.json` in Electron userData, using the
same atomic tmp+rename, debounced-write, corrupt-safe pattern as
`conversationStore.ts` / `shareStore.ts`.

```ts
export interface Skill {
  id: string           // uuid
  name: string         // "Raid Recap"
  whenToUse: string    // matching hint, e.g. "summarizing how a raid/WvW night went"
  instructions: string // the recipe (free-form; may require sections + {{figure}})
  enabled: boolean
  createdAt: string    // ISO
  updatedAt: string    // ISO
}
```

`SkillStore` methods: `list()`, `get(id)`, `getByName(name)`, `create(seed)`,
`update(id, patch)`, `remove(id)`. `list()` returns enabled+disabled; callers
filter on `enabled` where relevant.

## Matching & injection (the hybrid)

On each turn, `runTurn` builds the per-turn system prompt as:

```
AXIVALE_SYSTEM_PROMPT
+ <registry block>      // only when ≥1 enabled skill exists
+ <forced skill recipe> // only for explicit invocation
```

**Registry block** (lightweight, always-on when skills exist): one line per
enabled skill — `name` + `whenToUse` — plus a directive:

> "The user has defined skills. If the request matches a skill's 'when to use',
> call `load_skill` with its exact name and follow the returned instructions for
> this reply. Use at most one skill per reply; if none clearly fits, answer
> normally."

Empty catalog → no registry block (zero overhead; behaves exactly as today).

**Load on demand:** the full `instructions` enter context only when used — via the
`load_skill` tool (auto-match path) or injected directly (explicit path).

## Agent integration

- New read-only tool **`load_skill(name)`** in the tools registry: returns the
  named enabled skill's `instructions`, or a clear "no such skill: <name>"
  string when unknown/disabled (the agent then proceeds normally). Non-
  destructive — never added to `DESTRUCTIVE_TOOLS`, no confirm dialog.
- `AgentService.runTurn(conversationId, promptText, onEvent, opts?)` gains
  `opts.forcedSkillId?: string`. The adapter call's `systemPrompt` becomes the
  assembled per-turn prompt (base + registry + forced recipe) instead of the
  bare constant. A pure helper `buildTurnSystemPrompt(base, skills, forced?)`
  does the assembly and is unit-tested.
- The skill registry/recipes are read fresh from `SkillStore` per turn so edits
  take effect immediately.

## UI & IPC

- **Skills panel** (new `src/renderer/src/components/panels/Skills.tsx`,
  registered alongside Builds/Comps/Roster/Bureau and reachable from the
  masthead nav): lists skills with enable toggle, edit, delete, and a "New
  skill" form (name, when-to-use, instructions). Styled with existing panel
  classes in `theme.css`.
- **Explicit invocation:** the `InputBar` gets a skill chip/picker; typing `/`
  filters skills by name. Selecting one sets a pending `forcedSkillId` for the
  next send (shown as a removable chip). Cleared after send.
- **IPC / preload** (`src/preload/index.ts` + `index.d.ts`, handlers in
  `src/main/index.ts`): `skills:list`, `skills:create`, `skills:update`,
  `skills:delete`. `agent:send` gains an optional `forcedSkillId` argument
  threaded into `runTurn`.

## Error handling

- Empty/all-disabled catalog → no registry block injected.
- `load_skill` unknown/disabled → friendly "no such skill" result string; turn
  continues.
- Corrupt `skills.json` → empty list, never throws (mirrors the other stores).
- Explicit `forcedSkillId` that no longer exists → ignored (normal turn).
- Name collisions: `getByName` returns the first enabled match; the panel warns
  on duplicate names at create time (non-blocking).

## Testing

- `skillStore` — create/list/get/getByName/update/remove round-trips; atomic
  persistence across instances; corrupt-file safety.
- `buildTurnSystemPrompt` — empty catalog (no block), populated registry
  (names + when-to-use present, instructions absent), forced recipe injected.
- `load_skill` tool — found returns instructions; unknown/disabled returns the
  friendly miss string; never throws.
- IPC/preload type alignment for the new `skills:*` channels.
- (Renderer) a light Skills panel render/CRUD-callback test, matching the depth
  of existing panel tests.

Run vitest with `--maxWorkers=2` per the project constraint.

## Rollout notes

- Ships behind no flag; with an empty catalog the agent behaves exactly as
  before, so it's safe to merge before any skills exist.
- Deferred (future): agent-authored skills ("save that as a skill"), import/
  export, and a switch to a `load_skill`-only catalog if the registry block ever
  grows too large.
