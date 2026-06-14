# AxiVale Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users author reusable prompt "recipes" (skills) so recurring open-ended asks like "how did our raid go tonight?" produce consistent, structured answers — matched automatically from natural language or invoked explicitly.

**Architecture:** A `SkillStore` owns `skills.json` (same pattern as conversationStore/shareStore). Each turn, the agent's system prompt gets a lightweight **registry block** (every enabled skill's name + when-to-use) so it can recognize matches; the full recipe enters context only when used — via a read-only `load_skill` tool (auto-match) or injected directly (explicit `/skill`). A Skills panel does CRUD; the InputBar `/`-picker forces a skill for the next send.

**Tech Stack:** TypeScript, Electron (main + preload IPC), React 18, `@anthropic-ai/claude-agent-sdk` `tool()` + `zod`, vitest (+ @testing-library/react).

**Conventions (follow these):**
- Stores: atomic tmp+rename, debounced writes, corrupt-file-safe, path-injected for tests — see `src/main/conversationStore.ts` / `src/main/shareStore.ts`.
- Tools: `tool(name, description, zodSchema, handler)` returning `SdkMcpToolDefinition`; builders take injected deps — see `src/main/tools/axibridge.ts`. Registry in `src/main/tools/index.ts`.
- Renderer talks to main only via `window.officer.*`, typed in `src/preload/index.d.ts`.
- Run tests with `npx vitest run <file> --maxWorkers=2` (never exceed 2 workers).
- Commit after every task.

---

## File Structure

**New (main):**
- `src/main/skillStore.ts` — `Skill` type + `SkillStore` (CRUD over `skills.json`).
- `src/main/tools/skills.ts` — `buildSkillTools(loadSkill)` → the `load_skill` tool.
- `src/main/skillPrompt.ts` — `buildTurnSystemPrompt(base, skills, forced?)` (pure).

**New (renderer):**
- `src/renderer/src/components/panels/Skills.tsx` — manage skills.

**New (tests):**
- `src/main/skillStore.test.ts`, `src/main/tools/skills.test.ts` (or `src/main/skillTools.test.ts`), `src/main/skillPrompt.test.ts`, `src/renderer/src/components/panels/Skills.test.tsx`.

**Modified:**
- `src/main/tools/shared.ts` — add `loadSkill` to `ToolDeps`.
- `src/main/tools/index.ts` — include `buildSkillTools` in `buildOfficerTools`.
- `src/main/agent.ts` — `AgentDeps.skills`; `runTurn` opts `forcedSkillId`; assemble per-turn prompt.
- `src/main/index.ts` — construct `SkillStore`; wire `skills`/`loadSkill`; `skills:*` IPC; `agent:send` forwards `forcedSkillId`.
- `src/preload/index.ts` + `index.d.ts` — `skills*` methods + `RendererSkill`; `sendMessage` gains `forcedSkillId`.
- `src/renderer/src/components/Masthead.tsx` — add `'skills'` to `Section` + nav entry.
- `src/renderer/src/App.tsx` — skills list state, pending forced-skill, render panel, pass `forcedSkillId` to send.
- `src/renderer/src/components/InputBar.tsx` — skill picker / chip.
- `src/renderer/src/theme.css` — panel + chip styles.

---

## Task 1: SkillStore

**Files:**
- Create: `src/main/skillStore.ts`
- Test: `src/main/skillStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/skillStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillStore } from './skillStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillstore-'))
  path = join(dir, 'skills.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SkillStore', () => {
  it('creates skills with ids/timestamps and defaults enabled', () => {
    const s = new SkillStore(path)
    const sk = s.create({ name: 'Raid Recap', whenToUse: 'how raid went', instructions: 'do x' })
    expect(sk.id).toBeTruthy()
    expect(sk.enabled).toBe(true)
    expect(sk.createdAt).toBeTruthy()
    expect(s.list()).toHaveLength(1)
  })

  it('get / getByName (enabled-insensitive lookup by exact name)', () => {
    const s = new SkillStore(path)
    const sk = s.create({ name: 'Raid Recap', whenToUse: 'w', instructions: 'i' })
    expect(s.get(sk.id)?.name).toBe('Raid Recap')
    expect(s.getByName('Raid Recap')?.id).toBe(sk.id)
    expect(s.getByName('nope')).toBeNull()
  })

  it('update patches fields and bumps updatedAt; remove deletes', () => {
    const s = new SkillStore(path)
    const sk = s.create({ name: 'A', whenToUse: 'w', instructions: 'i' })
    const up = s.update(sk.id, { instructions: 'new', enabled: false })
    expect(up?.instructions).toBe('new')
    expect(up?.enabled).toBe(false)
    s.remove(sk.id)
    expect(s.get(sk.id)).toBeNull()
  })

  it('persists across instances and survives a corrupt file', () => {
    const s = new SkillStore(path)
    s.create({ name: 'A', whenToUse: 'w', instructions: 'i' })
    s.flush()
    expect(existsSync(path)).toBe(true)
    expect(new SkillStore(path).list()).toHaveLength(1)
    writeFileSync(path, 'not json')
    expect(new SkillStore(path).list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/skillStore.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './skillStore'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/skillStore.ts
//
// Owns userData/skills.json — user-authored prompt recipes. Mirrors
// ConversationStore/ShareStore: atomic tmp+rename, debounced, path-injected for
// tests, corrupt-file safe (never throws).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export interface Skill {
  id: string
  name: string
  whenToUse: string
  instructions: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type SkillSeed = Pick<Skill, 'name' | 'whenToUse' | 'instructions'> &
  Partial<Pick<Skill, 'enabled'>>

interface FileShape {
  skills: Skill[]
}

const DEBOUNCE_MS = 300

export class SkillStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { skills: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return { skills: Array.isArray(parsed.skills) ? parsed.skills : [] }
    } catch {
      return { skills: [] }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  list(): Skill[] {
    return [...this.state.skills].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): Skill | null {
    return this.state.skills.find((s) => s.id === id) ?? null
  }

  getByName(name: string): Skill | null {
    return this.state.skills.find((s) => s.name === name) ?? null
  }

  create(seed: SkillSeed): Skill {
    const now = new Date().toISOString()
    const skill: Skill = {
      id: randomUUID(),
      name: seed.name,
      whenToUse: seed.whenToUse,
      instructions: seed.instructions,
      enabled: seed.enabled ?? true,
      createdAt: now,
      updatedAt: now
    }
    this.state.skills.push(skill)
    this.scheduleWrite()
    return skill
  }

  update(id: string, patch: Partial<SkillSeed>): Skill | null {
    const skill = this.get(id)
    if (!skill) return null
    if (patch.name !== undefined) skill.name = patch.name
    if (patch.whenToUse !== undefined) skill.whenToUse = patch.whenToUse
    if (patch.instructions !== undefined) skill.instructions = patch.instructions
    if (patch.enabled !== undefined) skill.enabled = patch.enabled
    skill.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return skill
  }

  remove(id: string): void {
    this.state.skills = this.state.skills.filter((s) => s.id !== id)
    this.scheduleWrite()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/skillStore.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/skillStore.ts src/main/skillStore.test.ts
git commit -m "feat(skills): SkillStore (CRUD over skills.json)"
```

---

## Task 2: Per-turn system prompt assembly

**Files:**
- Create: `src/main/skillPrompt.ts`
- Test: `src/main/skillPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/skillPrompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildTurnSystemPrompt } from './skillPrompt'
import type { Skill } from './skillStore'

const BASE = 'BASE PROMPT'
function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'a', name: 'Raid Recap', whenToUse: 'how a raid/WvW night went',
    instructions: 'Lead with W/L then a {{figure}} trend then top 3.',
    enabled: true, createdAt: 'x', updatedAt: 'x', ...over
  }
}

describe('buildTurnSystemPrompt', () => {
  it('returns the base unchanged with no skills', () => {
    expect(buildTurnSystemPrompt(BASE, [])).toBe(BASE)
  })

  it('adds a registry of names + when-to-use, but NOT full instructions', () => {
    const out = buildTurnSystemPrompt(BASE, [skill()])
    expect(out.startsWith(BASE)).toBe(true)
    expect(out).toContain('Raid Recap')
    expect(out).toContain('how a raid/WvW night went')
    expect(out).toContain('load_skill')
    expect(out).not.toContain('Lead with W/L') // full recipe stays out
  })

  it('injects the forced skill recipe in full and omits the registry directive for it', () => {
    const out = buildTurnSystemPrompt(BASE, [skill()], skill())
    expect(out).toContain('Lead with W/L') // full recipe present
    expect(out).toContain('Raid Recap')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/skillPrompt.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './skillPrompt'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/skillPrompt.ts
//
// Assembles the per-turn system prompt: base constant + a lightweight registry
// of available skills (name + when-to-use only, so matching is cheap), plus the
// full recipe when a skill is explicitly forced for this turn. The full recipe
// of an auto-matched skill is fetched by the agent via the load_skill tool, not
// injected here.

import type { Skill } from './skillStore'

export function buildTurnSystemPrompt(
  base: string,
  skills: Skill[],
  forced?: Skill | null
): string {
  let out = base

  const enabled = skills.filter((s) => s.enabled)
  if (enabled.length > 0) {
    const lines = enabled.map((s) => `- ${s.name}: ${s.whenToUse}`).join('\n')
    out +=
      `\n\n# Available skills\n` +
      `The user has defined the skills below. If the request clearly matches a ` +
      `skill's "when to use", call the load_skill tool with its exact name and ` +
      `follow the returned instructions for this reply. Use at most one skill ` +
      `per reply; if none clearly fits, answer normally.\n` +
      lines
  }

  if (forced) {
    out +=
      `\n\n# Active skill: ${forced.name}\n` +
      `The user explicitly invoked this skill. Follow these instructions for ` +
      `this reply:\n${forced.instructions}`
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/skillPrompt.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/skillPrompt.ts src/main/skillPrompt.test.ts
git commit -m "feat(skills): per-turn system prompt assembly (registry + forced recipe)"
```

---

## Task 3: `load_skill` tool

**Files:**
- Create: `src/main/tools/skills.ts`
- Test: `src/main/skillTools.test.ts`
- Modify: `src/main/tools/shared.ts`, `src/main/tools/index.ts`

- [ ] **Step 1: Add `loadSkill` to ToolDeps**

In `src/main/tools/shared.ts`, add to the `ToolDeps` interface (after `axibridge`):

```ts
  /** Resolve an enabled skill's instructions by exact name, or null if missing/disabled. */
  loadSkill: (name: string) => string | null
```

- [ ] **Step 2: Write the failing test**

```ts
// src/main/skillTools.test.ts
import { describe, it, expect } from 'vitest'
import { buildSkillTools } from './tools/skills'

function call(loadSkill: (n: string) => string | null, name: string): Promise<string> {
  const tool = buildSkillTools(loadSkill)[0]
  // SDK tool handler returns { content: [{ type:'text', text }] }
  return tool
    .handler({ name }, {} as never)
    .then((r: { content: Array<{ text: string }> }) => r.content[0].text)
}

describe('load_skill tool', () => {
  it('returns the skill instructions when found', async () => {
    expect(await call((n) => (n === 'Raid Recap' ? 'do the recap' : null), 'Raid Recap')).toContain(
      'do the recap'
    )
  })

  it('returns a friendly miss string when unknown/disabled', async () => {
    expect(await call(() => null, 'Ghost')).toMatch(/no such skill/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/skillTools.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './tools/skills'`.

- [ ] **Step 4: Write the tool**

```ts
// src/main/tools/skills.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * The load_skill tool: returns a user-defined skill's full instructions by exact
 * name so the model can follow the recipe. Read-only — never destructive.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSkillTools(loadSkill: (name: string) => string | null): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'load_skill',
      'Load a user-defined skill\'s instructions by its exact name (from the "Available skills" list), then follow them for this reply.',
      { name: z.string().describe('Exact skill name from the Available skills list') },
      async ({ name }: { name: string }) => {
        const instructions = loadSkill(name)
        const text = instructions
          ? `Skill "${name}" — follow these instructions for this reply:\n\n${instructions}`
          : `No such skill: "${name}". Answer normally.`
        return { content: [{ type: 'text' as const, text }] }
      }
    )
  ]
}
```

- [ ] **Step 5: Include it in the registry**

In `src/main/tools/index.ts`: import and spread it into `buildOfficerTools`'s returned array.

```ts
import { buildSkillTools } from './skills'
```

Then inside `buildOfficerTools(deps)`'s `return [ ... ]`, add:

```ts
    ...buildSkillTools(deps.loadSkill),
```

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run src/main/skillTools.test.ts --maxWorkers=2`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: FAIL — every existing `ToolDeps` construction now misses `loadSkill`. That's wired in Task 5; if you want a green typecheck now, do Task 5 next. Note this and proceed.

- [ ] **Step 7: Commit**

```bash
git add src/main/tools/skills.ts src/main/skillTools.test.ts src/main/tools/shared.ts src/main/tools/index.ts
git commit -m "feat(skills): load_skill tool + ToolDeps.loadSkill"
```

---

## Task 4: Wire skills into the agent turn

**Files:**
- Modify: `src/main/agent.ts`

- [ ] **Step 1: Import the helpers + types**

Near the top of `src/main/agent.ts` (with the other imports):

```ts
import { buildTurnSystemPrompt } from './skillPrompt'
import type { Skill } from './skillStore'
```

- [ ] **Step 2: Add `skills` to AgentDeps**

In the `AgentDeps` interface (the block containing `saveSession`), add:

```ts
  /** Enabled skills, read fresh per turn (registry + forced-recipe lookup). */
  skills: () => Skill[]
```

- [ ] **Step 3: Add the `forcedSkillId` option to runTurn and assemble the prompt**

Change the `runTurn` signature:

```ts
  async runTurn(
    conversationId: string,
    promptText: string,
    onEvent: (e: AgentEvent) => void,
    opts?: { forcedSkillId?: string }
  ): Promise<void> {
```

Then where the adapter turn is created, replace the bare `systemPrompt: AXIVALE_SYSTEM_PROMPT` with the assembled prompt:

```ts
      const tools = buildOfficerTools(this.deps.toolDeps())
      const skills = this.deps.skills()
      const forced = opts?.forcedSkillId
        ? (skills.find((s) => s.id === opts.forcedSkillId) ?? null)
        : null
      const turn = adapter.runTurn({
        prompt: promptText,
        systemPrompt: buildTurnSystemPrompt(AXIVALE_SYSTEM_PROMPT, skills, forced),
        tools,
        confirm: this.deps.confirm,
        signal: abort.signal
      })
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: still FAIL until Task 5 supplies `skills`/`loadSkill` at construction. Proceed.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent.ts
git commit -m "feat(skills): assemble per-turn prompt with registry + forced skill"
```

---

## Task 5: Construct SkillStore + wire IPC

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import + construct the store**

In `src/main/index.ts`, add the import (near other store imports):

```ts
import { SkillStore } from './skillStore'
```

After the other stores are constructed (near `const shares = new ShareStore(...)`):

```ts
  const skills = new SkillStore(join(app.getPath('userData'), 'skills.json'))
```

- [ ] **Step 2: Wire skills + loadSkill into AgentService**

In the `new AgentService({ ... })` deps (line ~264), add a `skills` getter and add `loadSkill` to the `toolDeps()` object:

```ts
    skills: () => skills.list().filter((s) => s.enabled),
```

and inside `toolDeps: () => ({ ... })`:

```ts
      loadSkill: (name: string) => {
        const s = skills.getByName(name)
        return s && s.enabled ? s.instructions : null
      },
```

- [ ] **Step 3: Forward `forcedSkillId` from agent:send**

Replace the `agent:send` handler so it accepts and forwards the optional id:

```ts
  ipcMain.handle('agent:send', async (event, conversationId: string, prompt: string, forcedSkillId?: string) => {
    await agent.runTurn(conversationId, prompt, (agentEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('agent:event', { ...agentEvent, conversationId })
      }
    }, { forcedSkillId })
  })
```

(Keep the rest of the existing handler body identical — only the signature and the trailing `{ forcedSkillId }` arg change.)

- [ ] **Step 4: Add skills CRUD IPC handlers**

Near the other `ipcMain.handle` calls:

```ts
  ipcMain.handle('skills:list', () => skills.list())
  ipcMain.handle('skills:create', (_e, seed: { name: string; whenToUse: string; instructions: string }) =>
    skills.create(seed)
  )
  ipcMain.handle(
    'skills:update',
    (_e, id: string, patch: Partial<{ name: string; whenToUse: string; instructions: string; enabled: boolean }>) =>
      skills.update(id, patch)
  )
  ipcMain.handle('skills:delete', (_e, id: string) => skills.remove(id))
```

- [ ] **Step 5: Typecheck + main tests**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS (skills + loadSkill now provided).
Run: `npx vitest run src/main --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(skills): construct SkillStore, wire agent deps + skills IPC"
```

---

## Task 6: Preload API

**Files:**
- Modify: `src/preload/index.ts`, `src/preload/index.d.ts`

- [ ] **Step 1: Expose bridge methods**

In `src/preload/index.ts`, inside `exposeInMainWorld('officer', { ... })`:

```ts
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsCreate: (seed: { name: string; whenToUse: string; instructions: string }) =>
    ipcRenderer.invoke('skills:create', seed),
  skillsUpdate: (
    id: string,
    patch: Partial<{ name: string; whenToUse: string; instructions: string; enabled: boolean }>
  ) => ipcRenderer.invoke('skills:update', id, patch),
  skillsDelete: (id: string) => ipcRenderer.invoke('skills:delete', id),
```

And change the existing `sendMessage` to forward an optional forced skill id:

```ts
  sendMessage: (conversationId: string, text: string, forcedSkillId?: string) =>
    ipcRenderer.invoke('agent:send', conversationId, text, forcedSkillId),
```

- [ ] **Step 2: Types**

In `src/preload/index.d.ts`, add an exported interface and the methods on `OfficerApi`:

```ts
export interface RendererSkill {
  id: string
  name: string
  whenToUse: string
  instructions: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

```ts
  skillsList(): Promise<RendererSkill[]>
  skillsCreate(seed: { name: string; whenToUse: string; instructions: string }): Promise<RendererSkill>
  skillsUpdate(
    id: string,
    patch: Partial<{ name: string; whenToUse: string; instructions: string; enabled: boolean }>
  ): Promise<RendererSkill | null>
  skillsDelete(id: string): Promise<void>
```

And change the `sendMessage` signature in `OfficerApi`:

```ts
  sendMessage(conversationId: string, text: string, forcedSkillId?: string): Promise<void>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS (the App.test officer mock already provides `sendMessage`; the new `skills*` methods are only required where `window.officer` is fully typed — if `tsconfig.web.json` errors that App.test's `makeOfficer` is missing `skillsList`/etc., add them to that mock returning resolved defaults: `skillsList: vi.fn().mockResolvedValue([])`, `skillsCreate: vi.fn().mockResolvedValue({} as never)`, `skillsUpdate: vi.fn().mockResolvedValue(null)`, `skillsDelete: vi.fn().mockResolvedValue(undefined)`).

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts src/renderer/src/App.test.tsx
git commit -m "feat(skills): preload API for skills CRUD + forcedSkillId"
```

---

## Task 7: Skills management panel

**Files:**
- Create: `src/renderer/src/components/panels/Skills.tsx`
- Test: `src/renderer/src/components/panels/Skills.test.tsx`

First read an existing panel (e.g. `src/renderer/src/components/panels/Bureau.tsx`) to match its container classes/markup conventions; the classes below are reasonable defaults but prefer the file's real conventions where they differ.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/renderer/src/components/panels/Skills.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Skills from './Skills'

function officer(over: Record<string, unknown> = {}) {
  return {
    skillsList: vi.fn().mockResolvedValue([
      { id: '1', name: 'Raid Recap', whenToUse: 'how raid went', instructions: 'do x', enabled: true, createdAt: '', updatedAt: '' }
    ]),
    skillsCreate: vi.fn().mockResolvedValue({ id: '2', name: 'New', whenToUse: 'w', instructions: 'i', enabled: true, createdAt: '', updatedAt: '' }),
    skillsUpdate: vi.fn().mockResolvedValue(null),
    skillsDelete: vi.fn().mockResolvedValue(undefined),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Skills panel', () => {
  it('lists existing skills', async () => {
    render(<Skills />)
    expect(await screen.findByText('Raid Recap')).toBeTruthy()
  })

  it('creates a skill from the form', async () => {
    const create = vi.fn().mockResolvedValue({ id: '2', name: 'New', whenToUse: 'w', instructions: 'i', enabled: true, createdAt: '', updatedAt: '' })
    ;(window as unknown as { officer: unknown }).officer = officer({ skillsCreate: create })
    render(<Skills />)
    fireEvent.change(await screen.findByPlaceholderText(/name/i), { target: { value: 'Roster Check' } })
    fireEvent.change(screen.getByPlaceholderText(/when to use/i), { target: { value: 'roster' } })
    fireEvent.change(screen.getByPlaceholderText(/instructions/i), { target: { value: 'list inactive' } })
    fireEvent.click(screen.getByRole('button', { name: /add skill/i }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Roster Check', whenToUse: 'roster', instructions: 'list inactive' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/panels/Skills.test.tsx --maxWorkers=2`
Expected: FAIL — `Cannot find module './Skills'`.

- [ ] **Step 3: Write the panel**

```tsx
// src/renderer/src/components/panels/Skills.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { RendererSkill } from '../../../../preload/index.d'

export default function Skills(): ReactElement {
  const [skills, setSkills] = useState<RendererSkill[]>([])
  const [name, setName] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [instructions, setInstructions] = useState('')

  async function refresh(): Promise<void> {
    setSkills(await window.officer.skillsList())
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function add(): Promise<void> {
    if (!name.trim() || !whenToUse.trim() || !instructions.trim()) return
    await window.officer.skillsCreate({
      name: name.trim(),
      whenToUse: whenToUse.trim(),
      instructions: instructions.trim()
    })
    setName('')
    setWhenToUse('')
    setInstructions('')
    await refresh()
  }

  async function toggle(s: RendererSkill): Promise<void> {
    await window.officer.skillsUpdate(s.id, { enabled: !s.enabled })
    await refresh()
  }

  async function remove(s: RendererSkill): Promise<void> {
    if (!window.confirm(`Delete the "${s.name}" skill?`)) return
    await window.officer.skillsDelete(s.id)
    await refresh()
  }

  return (
    <div className="panel skills-panel">
      <div className="sgroup">
        <h2>New skill</h2>
        <p className="shelp">
          A skill is a reusable recipe. The agent follows it when a request matches
          “when to use” — or when you pick it explicitly.
        </p>
        <input className="sk-in" placeholder="Name (e.g. Raid Recap)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="sk-in" placeholder="When to use (e.g. summarizing how a raid night went)" value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)} />
        <textarea className="sk-in sk-area" placeholder="Instructions — what to pull, which tools, how to structure the reply" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <button className="sbtn out" onClick={() => void add()}>Add skill</button>
      </div>

      <div className="sgroup">
        <h2>Your skills</h2>
        {skills.length === 0 ? (
          <div className="sstatus">No skills yet.</div>
        ) : (
          <ul className="sk-list">
            {skills.map((s) => (
              <li key={s.id} className={`sk-row${s.enabled ? '' : ' off'}`}>
                <div className="sk-meta">
                  <span className="sk-name">{s.name}</span>
                  <span className="sk-when">{s.whenToUse}</span>
                </div>
                <div className="sk-acts">
                  <button className="sbtn" onClick={() => void toggle(s)}>{s.enabled ? 'Disable' : 'Enable'}</button>
                  <button className="sbtn" onClick={() => void remove(s)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/panels/Skills.test.tsx --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/panels/Skills.tsx src/renderer/src/components/panels/Skills.test.tsx
git commit -m "feat(skills): skills management panel"
```

---

## Task 8: Nav entry + render the panel

**Files:**
- Modify: `src/renderer/src/components/Masthead.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the section**

In `src/renderer/src/components/Masthead.tsx`, extend the `Section` union:

```ts
export type Section = 'dispatches' | 'builds' | 'comps' | 'roster' | 'bureau' | 'skills' | 'settings'
```

Find the nav rendering in Masthead (where 'builds'/'comps'/'roster'/'bureau' tabs are listed) and add a `skills` entry following the exact same markup as the adjacent tabs (label "Skills"). If the nav is data-driven from an array, add `'skills'` (with its label) to that array; if it's hardcoded buttons, copy one and change the section + label.

- [ ] **Step 2: Render the panel + title in App**

In `src/renderer/src/App.tsx`, import the panel near the other panel imports:

```ts
import Skills from './components/panels/Skills'
```

Add it alongside the other `section === '...'` panel renders (next to `{section === 'bureau' && <Bureau />}`):

```tsx
          {section === 'skills' && <Skills />}
```

If there is a `SECTION_TITLES` map in App, add `skills: 'Skills'` to it (match the existing entries' style).

- [ ] **Step 3: Typecheck + renderer tests**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer --maxWorkers=2`
Expected: PASS. (If a Masthead snapshot/test enumerates sections, update it to include 'skills'.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Masthead.tsx src/renderer/src/App.tsx
git commit -m "feat(skills): add Skills nav section + panel render"
```

---

## Task 9: Explicit invocation in the InputBar

**Files:**
- Modify: `src/renderer/src/components/InputBar.tsx`, `src/renderer/src/App.tsx`

First read `src/renderer/src/components/InputBar.tsx` to see how it currently calls send (prop name + signature) and where the send button/textarea live.

- [ ] **Step 1: Thread a forced-skill through App**

In `src/renderer/src/App.tsx`:
- Add state: `const [skills, setSkills] = useState<RendererSkill[]>([])` and load it: in a mount effect, `void window.officer.skillsList().then(setSkills)`. (Import `RendererSkill` from `'../../preload/index.d'`.)
- Add: `const [forcedSkillId, setForcedSkillId] = useState<string | null>(null)`.
- Find where App calls `window.officer.sendMessage(activeId, text)` (the send handler passed to InputBar) and pass the forced id, then clear it:

```ts
    void window.officer.sendMessage(conversationId, text, forcedSkillId ?? undefined)
    setForcedSkillId(null)
```

- Pass `skills`, `forcedSkillId`, and `setForcedSkillId` (or a typed callback) to `<InputBar ... />`.

- [ ] **Step 2: Picker + chip in InputBar**

In `InputBar.tsx`, accept the new props:

```ts
  skills: { id: string; name: string; enabled: boolean }[]
  forcedSkillId: string | null
  onForceSkill: (id: string | null) => void
```

Add a small picker: a `/` affordance (button labeled `/skill` or a dropdown) listing enabled skills; selecting one calls `onForceSkill(id)`. When `forcedSkillId` is set, render a removable chip near the textarea showing the skill name with an `×` that calls `onForceSkill(null)`. Minimal implementation:

```tsx
{forcedSkillId && (
  <span className="skill-chip">
    {skills.find((s) => s.id === forcedSkillId)?.name ?? 'skill'}
    <button aria-label="Clear skill" onClick={() => onForceSkill(null)}>×</button>
  </span>
)}
<select
  className="skill-pick"
  value=""
  onChange={(e) => e.target.value && onForceSkill(e.target.value)}
  aria-label="Use a skill"
>
  <option value="">/ skill…</option>
  {skills.filter((s) => s.enabled).map((s) => (
    <option key={s.id} value={s.id}>{s.name}</option>
  ))}
</select>
```

Place these next to the existing send controls (match the bar's layout).

- [ ] **Step 3: Typecheck + renderer tests**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer --maxWorkers=2`
Expected: PASS. If an existing InputBar test constructs `<InputBar>` without the new props and they're required, add the props to that test (`skills={[]} forcedSkillId={null} onForceSkill={() => {}}`).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/InputBar.tsx src/renderer/src/App.tsx
git commit -m "feat(skills): explicit skill invocation from the InputBar"
```

---

## Task 10: Styles

**Files:**
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: Append styles** (match existing token vars `--bg/--ink/--rule/--accent...`)

```css
/* ---- Skills panel ---- */
.skills-panel .sk-in{display:block;width:100%;box-sizing:border-box;margin:6px 0;background:rgba(0,0,0,.2);border:1px solid var(--line);color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:12px;padding:7px 9px}
.skills-panel .sk-area{min-height:96px;resize:vertical;line-height:1.5}
.sk-list{list-style:none;margin:8px 0 0;padding:0}
.sk-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--rule)}
.sk-row.off{opacity:.5}
.sk-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.sk-name{font-family:'Playfair Display',serif;font-size:15px}
.sk-when{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.04em;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px}
.sk-acts{display:flex;gap:8px;flex-shrink:0}
/* ---- InputBar skill picker ---- */
.skill-pick{background:rgba(0,0,0,.2);border:1px solid var(--line);color:var(--ink-dim);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:4px 6px;cursor:pointer}
.skill-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(200,66,58,.10);border:1px solid var(--accent);color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:3px 4px 3px 8px}
.skill-chip button{background:none;border:none;color:var(--accent-b);cursor:pointer;font-size:13px;line-height:1;padding:0 2px}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: completes, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "style(skills): panel + input picker styles"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Whole suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (incl. new skill tests).

- [ ] **Step 2: Typecheck both**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

`npm run dev`, then:
1. Open the **Skills** section → add a "Raid Recap" skill (when-to-use: "summarizing how a raid/WvW night went"; instructions: lead with W/L, then a `{{figure}}` trend, then top 3, then one improvement).
2. In dispatches, ask "how did our raid go tonight?" → the agent should call `load_skill` and produce the structured recap (verify with a guild that has AxiBridge data).
3. Use the InputBar `/skill` picker to force "Raid Recap" on an unrelated prompt → it applies regardless of phrasing; the chip clears after send.
4. Disable the skill in the panel → it no longer auto-matches.

---

## Self-Review Notes

- **Spec coverage:** data model/store (T1), hybrid matching = registry + load-on-demand (T2 registry, T3 load_skill tool, T4 assembly), explicit invocation (T2 forced branch, T5 IPC forward, T9 InputBar), authoring UI (T7), nav (T8), IPC/preload (T5/T6), error handling (T1 corrupt-safe, T3 miss string, T2 empty-catalog no-op), testing (each task) — all mapped.
- **Type consistency:** `Skill` (T1) is the single source; `RendererSkill` (T6) mirrors it across IPC; `ToolDeps.loadSkill: (name) => string | null` (T3) matches its construction (T5) and the tool (T3); `buildTurnSystemPrompt(base, skills, forced?)` (T2) matches its call in `runTurn` (T4); `runTurn(..., opts?: { forcedSkillId? })` (T4) matches `agent:send` (T5) and `sendMessage` (T6/T9).
- **Cross-task typecheck dips are flagged:** T3/T4 leave `tsc` red until T5 supplies `loadSkill`/`skills` at construction — noted in those tasks with the resolution order.
