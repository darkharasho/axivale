# Multi-Provider LLM Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AxiVale run on Claude (today's path), Gemini, OpenAI, or a local Ollama-compatible server, chosen explicitly in Settings, all driving the same 24 officer tools and the same renderer event stream.

**Architecture:** A `ProviderAdapter` layer in `src/main/providers/`. The existing Claude Agent SDK code is extracted into `ClaudeAdapter`; Gemini and OpenAI get `fetch`-based adapters that run their own tool-calling loop (stream → gate destructive tools → execute tool handlers → feed results back). `AgentService` becomes provider-agnostic and keeps emitting the existing `AgentEvent` union, so the renderer chat pipeline is untouched. Settings/keyring grow `gemini`/`openai` services and a local endpoint.

**Tech Stack:** TypeScript, Electron 33 (main process has global `fetch`), Zod 4 (`z.toJSONSchema`), vitest. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-06-12-multi-provider-llm-design.md`

**Test command (always):** `npx vitest run --maxWorkers=2` (memory limit per user's global config). Typecheck: `npm run typecheck`.

## File structure

| File | Responsibility |
|---|---|
| `src/main/providers/types.ts` (new) | `AgentEvent`, `ProviderAdapter`, `TurnInput`, `ProviderName`, `ProviderConfig`, `MCP_PREFIX` |
| `src/main/providers/permission.ts` (new) | `evaluateToolPermission` + `PermissionResult` (moved from agent.ts) |
| `src/main/providers/toolSchema.ts` (new) | Zod→JSON-Schema tool specs, tool execution, permission-gated runner |
| `src/main/providers/sse.ts` (new) | SSE `data:` line parser over a ReadableStream |
| `src/main/providers/claude.ts` (new) | `ClaudeAdapter` + `translateSdkMessage` (moved from agent.ts) |
| `src/main/providers/openaiCompat.ts` (new) | `OpenAIChatAdapter` — OpenAI API and local OpenAI-compatible servers |
| `src/main/providers/gemini.ts` (new) | `GeminiAdapter` |
| `src/main/providers/index.ts` (new) | `createAdapter()` factory |
| `src/main/agent.ts` (modify) | Provider-agnostic `AgentService`; keeps `AXIVALE_SYSTEM_PROMPT`; re-exports moved symbols |
| `src/main/secrets.ts` (modify) | New `KeyService`s `gemini`/`openai`, new `SettingKey`s |
| `src/main/index.ts` (modify) | `providerConfig()`, IPC `local:status` + `provider:status` |
| `src/preload/index.ts` + `index.d.ts` (modify) | Expose `localStatus`, `providerStatus`; widen key-service types |
| `src/renderer/src/components/Settings.tsx` (modify) | Provider picker + per-provider config blocks |
| `src/renderer/src/App.tsx` (modify) | First-run setup nudge in the empty chat state |

---

### Task 1: Provider types + permission module (pure refactor)

**Files:**
- Create: `src/main/providers/types.ts`
- Create: `src/main/providers/permission.ts`
- Modify: `src/main/agent.ts`
- Tests: existing `src/main/agent.test.ts` must stay green unchanged

- [ ] **Step 1: Create `src/main/providers/types.ts`**

```ts
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
  | { kind: 'done'; sessionId: string | null; error: string | null }

export const MCP_PREFIX = 'mcp__officer__'

export type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'

/** Snapshot of everything an adapter needs from settings — read fresh each turn. */
export interface ProviderConfig {
  provider: ProviderName
  /** Model id/alias from settings; null/'' = provider default. */
  model: string | null
  /** Claude Code OAuth token (claude provider only). */
  oauthToken: string | null
  /** Active API key (gemini/openai providers only). */
  apiKey: string | null
  /** Local server base url, e.g. http://localhost:11434 (local provider only). */
  endpoint: string | null
}

export interface TurnInput {
  prompt: string
  systemPrompt: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Array<SdkMcpToolDefinition<any>>
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  signal: AbortSignal
}

export interface ProviderAdapter {
  /** Streams renderer events for one user turn. Throws on provider errors;
   *  AgentService catches and emits the final done event. */
  runTurn(input: TurnInput): AsyncGenerator<AgentEvent>
  /** Clears conversation state (new conversation). */
  reset(): void
}
```

- [ ] **Step 2: Create `src/main/providers/permission.ts`**

Move `evaluateToolPermission` and `PermissionResult` out of `agent.ts` verbatim (currently `src/main/agent.ts:137-173`), importing `MCP_PREFIX` from `./types`:

```ts
import { MCP_PREFIX } from './types'
import { DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS } from '../tools'

/** The result type returned by canUseTool callbacks. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/**
 * Pure function that decides whether a tool call is allowed.
 * Extracted so it can be unit-tested without running a full agent turn.
 *
 * Built-in SDK tools (e.g. Bash) are not in allowedTools and would otherwise
 * fall through to allow — the non-officer prefix check blocks them explicitly.
 */
export async function evaluateToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  deps: { confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean> }
): Promise<PermissionResult> {
  // Only officer MCP tools are permitted in this app.
  if (!toolName.startsWith(MCP_PREFIX)) {
    return { behavior: 'deny', message: 'Only officer tools are available in this app.' }
  }

  const bare = toolName.slice(MCP_PREFIX.length)
  // Action-gated tools' risk depends on the verb, not the tool name.
  const gatedVerbs = ACTION_GATED_TOOLS[bare]
  const destructive = gatedVerbs
    ? gatedVerbs.includes(String(input.action ?? ''))
    : DESTRUCTIVE_TOOLS.includes(bare)
  if (destructive) {
    const allowed = await deps.confirm(bare, input)
    if (!allowed) {
      return { behavior: 'deny', message: 'The user declined this action.' }
    }
  }

  return { behavior: 'allow', updatedInput: input }
}
```

- [ ] **Step 3: Update `src/main/agent.ts` to re-export instead of define**

Delete the `AgentEvent` type (lines 9-13), `const MCP_PREFIX` (line 15), `PermissionResult` (lines 137-140), and `evaluateToolPermission` (lines 142-173) from `agent.ts`. At the top add:

```ts
import { MCP_PREFIX, type AgentEvent } from './providers/types'
import { evaluateToolPermission } from './providers/permission'

export { MCP_PREFIX, evaluateToolPermission }
export type { AgentEvent }
export type { PermissionResult } from './providers/permission'
```

(Keep the existing `query`/`createSdkMcpServer` imports and everything else untouched for now — `AgentService` still works exactly as before in this task.)

- [ ] **Step 4: Run tests and typecheck — must pass with zero test edits**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: all suites PASS (agent.test.ts imports `evaluateToolPermission` from `./agent`, which now re-exports it).

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/types.ts src/main/providers/permission.ts src/main/agent.ts
git commit -m "refactor: extract provider types and tool permission gate into src/main/providers"
```

---

### Task 2: Tool schema translation & execution

**Files:**
- Create: `src/main/providers/toolSchema.ts`
- Test: `src/main/providers/toolSchema.test.ts`

- [ ] **Step 1: Write the failing test `src/main/providers/toolSchema.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { toToolSpecs, executeTool, gateAndRunTool } from './toolSchema'
import { buildOfficerTools } from '../tools'

const echo = tool(
  'echo_tool',
  'Echoes its input.',
  { message: z.string().describe('What to echo'), times: z.number().optional() },
  async (args: { message: string }) => ({
    content: [{ type: 'text' as const, text: args.message }]
  })
)

describe('toToolSpecs', () => {
  it('produces a JSON schema with required/optional fields and no $schema key', () => {
    const [spec] = toToolSpecs([echo])
    expect(spec.name).toBe('echo_tool')
    expect(spec.description).toBe('Echoes its input.')
    expect(spec.parameters).toMatchObject({
      type: 'object',
      properties: {
        message: expect.objectContaining({ type: 'string', description: 'What to echo' }),
        times: expect.objectContaining({ type: 'number' })
      },
      required: ['message']
    })
    expect(spec.parameters).not.toHaveProperty('$schema')
  })

  it('translates every officer tool without throwing', () => {
    const tools = buildOfficerTools({
      axitools: {} as never,
      gw2: {} as never,
      discordGuildId: () => '1',
      gw2GuildId: () => 'g1'
    })
    const specs = toToolSpecs(tools)
    expect(specs.length).toBe(tools.length)
    for (const spec of specs) {
      expect(spec.name).toBeTruthy()
      expect((spec.parameters as { type: string }).type).toBe('object')
    }
  })
})

describe('executeTool', () => {
  it('runs the handler and returns its text', async () => {
    const outcome = await executeTool([echo], 'echo_tool', { message: 'hi' })
    expect(outcome).toEqual({ text: 'hi', isError: false })
  })

  it('rejects invalid arguments with a corrective error, not a crash', async () => {
    const outcome = await executeTool([echo], 'echo_tool', { message: 42 })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain('Invalid arguments')
  })

  it('reports unknown tools as errors', async () => {
    const outcome = await executeTool([echo], 'nope', {})
    expect(outcome).toEqual({ text: 'Unknown tool: nope', isError: true })
  })
})

describe('gateAndRunTool', () => {
  it('runs safe tools without confirmation', async () => {
    const confirm = vi.fn()
    const outcome = await gateAndRunTool([echo], 'echo_tool', { message: 'ok' }, confirm)
    expect(outcome.text).toBe('ok')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('returns a deny message when the user declines a destructive tool', async () => {
    const del = tool('axitools_builds_delete', 'Deletes.', { build_id: z.string() }, async () => ({
      content: [{ type: 'text' as const, text: 'deleted' }]
    }))
    const confirm = vi.fn().mockResolvedValue(false)
    const outcome = await gateAndRunTool([del], 'axitools_builds_delete', { build_id: 'b1' }, confirm)
    expect(outcome).toEqual({ text: 'The user declined this action.', isError: true })
    expect(confirm).toHaveBeenCalledWith('axitools_builds_delete', { build_id: 'b1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/providers/toolSchema.test.ts`
Expected: FAIL — `Cannot find module './toolSchema'`

- [ ] **Step 3: Implement `src/main/providers/toolSchema.ts`**

```ts
import { z } from 'zod'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { MCP_PREFIX } from './types'
import { evaluateToolPermission } from './permission'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tools = Array<SdkMcpToolDefinition<any>>

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>
}

export interface ToolOutcome {
  text: string
  isError: boolean
}

/** The SDK's tool() stores the raw Zod shape it was given; normalize to a ZodObject. */
function zodObjectOf(t: SdkMcpToolDefinition<any>): z.ZodObject<z.ZodRawShape> {
  const schema = t.inputSchema
  if (schema instanceof z.ZodObject) return schema
  return z.object((schema ?? {}) as z.ZodRawShape)
}

/** Provider-neutral tool descriptions for OpenAI/Gemini function calling. */
export function toToolSpecs(tools: Tools): ToolSpec[] {
  return tools.map((t) => {
    const parameters = z.toJSONSchema(zodObjectOf(t), { io: 'input' }) as Record<string, unknown>
    delete parameters.$schema
    return { name: t.name, description: t.description ?? '', parameters }
  })
}

/**
 * Validates input against the tool's Zod schema and runs its handler.
 * The Claude SDK does this validation internally; non-Claude adapters call
 * handlers directly, so it must happen here — weak models send bad JSON.
 */
export async function executeTool(
  tools: Tools,
  name: string,
  input: Record<string, unknown>
): Promise<ToolOutcome> {
  const t = tools.find((candidate) => candidate.name === name)
  if (!t) return { text: `Unknown tool: ${name}`, isError: true }
  const parsed = zodObjectOf(t).safeParse(input)
  if (!parsed.success) {
    return { text: `Invalid arguments for ${name}: ${parsed.error.message}`, isError: true }
  }
  // Handlers are wrapped in tools.ts safe(): they never throw, errors come back as isError results.
  const result = await t.handler(parsed.data, {})
  const text = (result.content ?? [])
    .map((part: { type: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
  return { text, isError: result.isError === true }
}

/** Permission gate (destructive-tool confirm) + execution, for non-Claude adapters. */
export async function gateAndRunTool(
  tools: Tools,
  name: string,
  input: Record<string, unknown>,
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
): Promise<ToolOutcome> {
  const permission = await evaluateToolPermission(`${MCP_PREFIX}${name}`, input, { confirm })
  if (permission.behavior === 'deny') return { text: permission.message, isError: true }
  return executeTool(tools, name, permission.updatedInput ?? input)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/providers/toolSchema.test.ts`
Expected: PASS. If `z.toJSONSchema(..., { io: 'input' })` errors on the installed Zod (4.4.3), drop the options argument — plain `z.toJSONSchema(zodObjectOf(t))` is acceptable; re-run.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/toolSchema.ts src/main/providers/toolSchema.test.ts
git commit -m "feat: provider-neutral tool specs, validated execution, and gated runner"
```

---

### Task 3: SSE stream parser

**Files:**
- Create: `src/main/providers/sse.ts`
- Test: `src/main/providers/sse.test.ts`

- [ ] **Step 1: Write the failing test `src/main/providers/sse.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { sseData } from './sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const data of sseData(stream)) out.push(data)
  return out
}

describe('sseData', () => {
  it('yields data payloads and skips [DONE], comments, and blank lines', async () => {
    const stream = streamOf('data: {"a":1}\n\n: keepalive\n\ndata: {"b":2}\n\ndata: [DONE]\n\n')
    expect(await collect(stream)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('reassembles events split across network chunks', async () => {
    const stream = streamOf('data: {"long', '":"val', 'ue"}\n\n')
    expect(await collect(stream)).toEqual(['{"long":"value"}'])
  })

  it('handles CRLF line endings', async () => {
    const stream = streamOf('data: {"x":1}\r\n\r\n')
    expect(await collect(stream)).toEqual(['{"x":1}'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/providers/sse.test.ts`
Expected: FAIL — `Cannot find module './sse'`

- [ ] **Step 3: Implement `src/main/providers/sse.ts`**

```ts
/**
 * Iterates the `data:` payloads of a Server-Sent-Events body.
 * Skips comments, blank lines, and the OpenAI-style `[DONE]` sentinel.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data && data !== '[DONE]') yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/providers/sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/sse.ts src/main/providers/sse.test.ts
git commit -m "feat: SSE data-line parser for streaming provider responses"
```

---

### Task 4: Extract ClaudeAdapter; AgentService goes provider-agnostic

**Files:**
- Create: `src/main/providers/claude.ts`
- Create: `src/main/providers/index.ts`
- Modify: `src/main/agent.ts` (AgentService deps + delegation)
- Modify: `src/main/index.ts` (new deps shape)
- Modify: `src/main/agent.test.ts` (deps shape only)
- Existing test: `src/main/agentEvents.test.ts` must stay green unchanged

- [ ] **Step 1: Create `src/main/providers/claude.ts`**

Move `translateSdkMessage` (currently `src/main/agent.ts:60-127`) verbatim into this file, then add the adapter:

```ts
import { query, createSdkMcpServer, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  MCP_PREFIX,
  type AgentEvent,
  type ProviderAdapter,
  type ProviderConfig,
  type TurnInput
} from './types'
import { evaluateToolPermission } from './permission'
import { DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS } from '../tools'

export function translateSdkMessage(msg: SDKMessage): AgentEvent[] {
  // ... moved verbatim from agent.ts lines 60-127, including comments ...
}

/** The original Claude Agent SDK path, behind the ProviderAdapter interface. */
export class ClaudeAdapter implements ProviderAdapter {
  private sessionId: string | null = null

  constructor(private readonly config: () => ProviderConfig) {}

  reset(): void {
    this.sessionId = null
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const server = createSdkMcpServer({ name: 'officer', version: '1.0.0', tools: input.tools })
    // Destructive tools are deliberately NOT pre-allowed: allowedTools entries
    // are auto-approved without ever reaching canUseTool, so destructive ones
    // must go through the permission flow to hit our confirm gate.
    // Action-gated tools always route through canUseTool, which confirms
    // only their destructive verbs.
    const allowedTools = input.tools
      .map((t) => `${MCP_PREFIX}${t.name}`)
      .filter((name) => {
        const bare = name.slice(MCP_PREFIX.length)
        return !DESTRUCTIVE_TOOLS.includes(bare) && !(bare in ACTION_GATED_TOOLS)
      })
    const { oauthToken, model } = this.config()
    // Options.env REPLACES the subprocess environment entirely, so spread process.env.
    const env: Record<string, string | undefined> = { ...process.env }
    if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

    // Bridge the turn's AbortSignal to the controller the SDK expects.
    const abortController = new AbortController()
    if (input.signal.aborted) abortController.abort()
    const onAbort = (): void => abortController.abort()
    input.signal.addEventListener('abort', onAbort)
    try {
      const q = query({
        prompt: input.prompt,
        options: {
          mcpServers: { officer: server },
          allowedTools,
          systemPrompt: input.systemPrompt,
          includePartialMessages: true,
          env,
          abortController,
          ...(model ? { model } : {}),
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          canUseTool: async (toolName, toolInput) =>
            evaluateToolPermission(toolName, toolInput as Record<string, unknown>, {
              confirm: input.confirm
            })
        }
      })
      for await (const msg of q) {
        for (const event of translateSdkMessage(msg)) {
          if (event.kind === 'done' && event.sessionId) this.sessionId = event.sessionId
          yield event
        }
      }
    } finally {
      input.signal.removeEventListener('abort', onAbort)
    }
  }
}
```

- [ ] **Step 2: Create `src/main/providers/index.ts`**

```ts
import type { ProviderAdapter, ProviderConfig, ProviderName } from './types'
import { ClaudeAdapter } from './claude'

export function createAdapter(
  provider: ProviderName,
  config: () => ProviderConfig
): ProviderAdapter {
  switch (provider) {
    // gemini / openai / local cases land in Tasks 6-7.
    default:
      return new ClaudeAdapter(config)
  }
}
```

- [ ] **Step 3: Rewrite `src/main/agent.ts`**

Replace the whole file body below the system prompt with the provider-agnostic service. Final file shape (system prompt stays verbatim — elided here for brevity, do NOT change its text):

```ts
import { buildOfficerTools, type ToolDeps } from './tools'
import { MCP_PREFIX, type AgentEvent, type ProviderConfig, type ProviderName } from './providers/types'
import { evaluateToolPermission } from './providers/permission'
import { createAdapter } from './providers'
import type { ProviderAdapter } from './providers/types'

export { MCP_PREFIX, evaluateToolPermission }
export type { AgentEvent }
export type { PermissionResult } from './providers/permission'
export { translateSdkMessage } from './providers/claude'

const AXIVALE_SYSTEM_PROMPT = `You are AxiVale — ...`  // UNCHANGED, keep existing text verbatim

export interface AgentDeps {
  toolDeps: () => ToolDeps
  /** Provider, model, and credentials — read fresh at the start of every turn. */
  config: () => ProviderConfig
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
}

export class AgentService {
  private adapter: ProviderAdapter | null = null
  private adapterProvider: ProviderName | null = null
  private running = false
  private abort: AbortController | null = null

  constructor(private readonly deps: AgentDeps) {}

  /** Returns the adapter for the configured provider; switching providers starts fresh. */
  private currentAdapter(): ProviderAdapter {
    const provider = this.deps.config().provider
    if (!this.adapter || this.adapterProvider !== provider) {
      this.adapter = createAdapter(provider, this.deps.config)
      this.adapterProvider = provider
    }
    return this.adapter
  }

  resetSession(): void {
    this.adapter?.reset()
  }

  /** Abort the in-flight turn, if any. The runTurn loop ends cleanly. */
  cancelTurn(): void {
    this.abort?.abort()
  }

  async runTurn(promptText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    if (this.running) {
      onEvent({
        kind: 'done',
        sessionId: null,
        error: 'A turn is already in progress — wait for it to finish.'
      })
      return
    }

    this.running = true
    const abort = new AbortController()
    this.abort = abort
    try {
      const tools = buildOfficerTools(this.deps.toolDeps())
      const adapter = this.currentAdapter()
      const turn = adapter.runTurn({
        prompt: promptText,
        systemPrompt: AXIVALE_SYSTEM_PROMPT,
        tools,
        confirm: this.deps.confirm,
        signal: abort.signal
      })
      for await (const event of turn) onEvent(event)
    } catch (err) {
      // A user-initiated cancel ends the turn cleanly, not as an error.
      onEvent({
        kind: 'done',
        sessionId: null,
        error: abort.signal.aborted ? null : err instanceof Error ? err.message : String(err)
      })
    } finally {
      this.running = false
      this.abort = null
    }
  }
}
```

- [ ] **Step 4: Update `src/main/index.ts` to the new deps shape**

Replace the `oauthToken` and `model` lines in the `new AgentService({...})` call (`src/main/index.ts:74-75`) with:

```ts
    config: () => ({
      provider: 'claude' as const, // provider setting wired in Task 8
      model: store.getSetting('model'),
      oauthToken: store.getSecret('claudeOauthToken'),
      apiKey: null,
      endpoint: null
    }),
```

- [ ] **Step 5: Update `src/main/agent.test.ts` deps**

In the `AgentService turn serialization` test, replace the `oauthToken: () => null,` and `model: () => null,` lines of `mockDeps` with:

```ts
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
```

The `vi.mock('@anthropic-ai/claude-agent-sdk', ...)` block stays exactly as is — `providers/claude.ts` imports `query` from the same module, so the mock still intercepts it.

- [ ] **Step 6: Run all tests and typecheck**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS — including `agentEvents.test.ts` untouched (it imports `translateSdkMessage` from `./agent`, which now re-exports it).

- [ ] **Step 7: Launch the app and smoke-test the Claude path**

Run: `npm run dev`, send a prompt that triggers a tool (e.g. "list our builds"), confirm streaming text + tool coupons render as before. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/main/providers/claude.ts src/main/providers/index.ts src/main/agent.ts src/main/index.ts src/main/agent.test.ts
git commit -m "refactor: ClaudeAdapter behind ProviderAdapter; AgentService is provider-agnostic"
```

---

### Task 5: Secrets/settings expansion

**Files:**
- Modify: `src/main/secrets.ts`
- Test: `src/main/secrets.test.ts` (append cases)

- [ ] **Step 1: Write the failing tests — append to `src/main/secrets.test.ts`**

Match the file's existing setup pattern (it constructs `SettingsStore` with a temp path and a fake cipher — reuse whatever helper it already defines):

```ts
describe('provider keyrings', () => {
  it('supports gemini and openai keyrings with active-key selection', () => {
    const store = makeStore() // reuse the existing test helper for a fresh store
    store.addKey('gemini', 'personal', 'AIza-test')
    store.setActiveKey('gemini', 'personal')
    expect(store.getActiveKey('gemini')).toBe('AIza-test')
    expect(store.listKeyLabels('gemini')).toEqual([{ label: 'personal', active: true }])

    store.addKey('openai', 'work', 'sk-test')
    expect(store.getActiveKey('openai')).toBe('sk-test')
    // services are independent rings
    expect(store.getActiveKey('gemini')).toBe('AIza-test')
  })

  it('returns an empty ring for new services with no legacy secret to migrate', () => {
    const store = makeStore()
    expect(store.listKeyLabels('openai')).toEqual([])
    expect(store.getActiveKey('openai')).toBeNull()
  })
})
```

If `secrets.test.ts` has no shared `makeStore` helper, inline whatever construction its existing tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/secrets.test.ts`
Expected: FAIL — type errors / unknown service `'gemini'`

- [ ] **Step 3: Extend the types and maps in `src/main/secrets.ts`**

```ts
export type SecretKey =
  | 'claudeOauthToken'
  | 'gw2ApiKey'
  | 'axivaleKey'
  | 'gw2Keys'
  | 'axivaleKeys'
  | 'geminiKeys'
  | 'openaiKeys'
export type SettingKey =
  | 'guildId'
  | 'gw2GuildId'
  | 'gw2AccountName'
  | 'model'
  | 'gw2ActiveKey'
  | 'axivaleActiveKey'
  | 'provider'
  | 'localEndpoint'
  | 'geminiModel'
  | 'openaiModel'
  | 'localModel'
  | 'geminiActiveKey'
  | 'openaiActiveKey'

/** Services that hold a ring of labeled keys with one active. */
export type KeyService = 'gw2' | 'axivale' | 'gemini' | 'openai'
```

```ts
const RING_SECRET: Record<KeyService, SecretKey> = {
  gw2: 'gw2Keys',
  axivale: 'axivaleKeys',
  gemini: 'geminiKeys',
  openai: 'openaiKeys'
}
// Only the original services have pre-keyring single secrets to migrate.
const LEGACY_SECRET: Partial<Record<KeyService, SecretKey>> = {
  gw2: 'gw2ApiKey',
  axivale: 'axivaleKey'
}
const ACTIVE_SETTING: Record<KeyService, SettingKey> = {
  gw2: 'gw2ActiveKey',
  axivale: 'axivaleActiveKey',
  gemini: 'geminiActiveKey',
  openai: 'openaiActiveKey'
}
```

And in `readRing` (around line 103), make the legacy lookup tolerate services without one:

```ts
    // Migrate a legacy single secret into the ring on first read.
    const legacySecret = LEGACY_SECRET[service]
    const legacy = legacySecret ? this.getSecret(legacySecret) : null
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/secrets.ts src/main/secrets.test.ts
git commit -m "feat: gemini/openai keyrings and provider settings in SettingsStore"
```

---

### Task 6: OpenAIChatAdapter (OpenAI + Local)

**Files:**
- Create: `src/main/providers/openaiCompat.ts`
- Test: `src/main/providers/openaiCompat.test.ts`

- [ ] **Step 1: Write the failing test `src/main/providers/openaiCompat.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { OpenAIChatAdapter } from './openaiCompat'
import type { AgentEvent, ProviderConfig, TurnInput } from './types'

const echo = tool('echo_tool', 'Echoes.', { message: z.string() }, async (args: { message: string }) => ({
  content: [{ type: 'text' as const, text: `echo:${args.message}` }]
}))

function sseBody(events: unknown[]): Response {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function turnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    prompt: 'hello',
    systemPrompt: 'You are a test.',
    tools: [echo],
    confirm: vi.fn().mockResolvedValue(true),
    signal: new AbortController().signal,
    ...overrides
  }
}

const openaiConfig: ProviderConfig = {
  provider: 'openai',
  model: 'test-model',
  oauthToken: null,
  apiKey: 'sk-test',
  endpoint: null
}

async function collect(adapter: OpenAIChatAdapter, input: TurnInput): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const e of adapter.runTurn(input)) events.push(e)
  return events
}

describe('OpenAIChatAdapter', () => {
  it('streams text deltas and finishes with a clean done', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }
      ])
    )
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toEqual([
      { kind: 'text-delta', text: 'Hel' },
      { kind: 'text-delta', text: 'lo' },
      { kind: 'done', sessionId: null, error: null }
    ])
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('test-model')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test.' })
    expect(body.tools[0].function.name).toBe('echo_tool')
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
  })

  it('executes a tool call and loops back with the result', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_1', function: { name: 'echo_tool', arguments: '{"mess' } }
                  ]
                }
              }
            ]
          },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: 'age":"hi"}' } }] },
                finish_reason: 'tool_calls'
              }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ choices: [{ delta: { content: 'done!' }, finish_reason: 'stop' }] }]))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toContainEqual({
      kind: 'tool-start',
      id: 'call_1',
      name: 'echo_tool',
      input: { message: 'hi' }
    })
    expect(events).toContainEqual({ kind: 'tool-result', id: 'call_1', isError: false, text: 'echo:hi' })
    expect(events[events.length - 1]).toEqual({ kind: 'done', sessionId: null, error: null })
    // second request carries the assistant tool_calls message + tool result
    const second = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    const roles = second.messages.map((m: { role: string }) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool'])
  })

  it('keeps history across turns and clears it on reset', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    )
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput({ prompt: 'first' }))
    await collect(adapter, turnInput({ prompt: 'second' }))
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user'
    ])
    adapter.reset()
    await collect(adapter, turnInput({ prompt: 'third' }))
    const fresh = JSON.parse((fetchFn.mock.calls[2][1] as RequestInit).body as string)
    expect(fresh.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
  })

  it('throws a labeled error on a non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    await expect(collect(adapter, turnInput())).rejects.toThrow(/OpenAI request failed \(401\)/)
  })

  it('feeds malformed tool-call JSON back as an error result instead of crashing', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'c1', function: { name: 'echo_tool', arguments: '{oops' } }]
                },
                finish_reason: 'tool_calls'
              }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ choices: [{ delta: { content: 'sorry' }, finish_reason: 'stop' }] }]))
    const adapter = new OpenAIChatAdapter(() => openaiConfig, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    const result = events.find((e) => e.kind === 'tool-result')
    expect(result).toMatchObject({ isError: true })
  })

  it('uses the local endpoint without auth when provider is local', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
    )
    const localConfig: ProviderConfig = {
      provider: 'local',
      model: 'qwen3:8b',
      oauthToken: null,
      apiKey: null,
      endpoint: 'http://localhost:11434'
    }
    const adapter = new OpenAIChatAdapter(() => localConfig, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput())
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions')
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/providers/openaiCompat.test.ts`
Expected: FAIL — `Cannot find module './openaiCompat'`

- [ ] **Step 3: Implement `src/main/providers/openaiCompat.ts`**

```ts
import type { AgentEvent, ProviderAdapter, ProviderConfig, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool } from './toolSchema'
import { sseData } from './sse'

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/** Hard ceiling on model→tools round-trips per turn; weak models can loop forever. */
const MAX_TOOL_ROUNDS = 25

/**
 * Adapter for the OpenAI Chat Completions API and any OpenAI-compatible
 * local server (Ollama, LM Studio, llama.cpp server).
 */
export class OpenAIChatAdapter implements ProviderAdapter {
  private history: ChatMessage[] = []

  constructor(
    private readonly config: () => ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  reset(): void {
    this.history = []
  }

  private target(): { url: string; headers: Record<string, string>; model: string; label: string } {
    const cfg = this.config()
    if (cfg.provider === 'local') {
      const base = (cfg.endpoint || 'http://localhost:11434').replace(/\/+$/, '')
      return {
        url: `${base}/v1/chat/completions`,
        headers: {},
        model: cfg.model || 'qwen3:8b',
        label: 'Local model'
      }
    }
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      model: cfg.model || 'gpt-5.1',
      label: 'OpenAI'
    }
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const tools = toToolSpecs(input.tools).map((s) => ({
      type: 'function' as const,
      function: { name: s.name, description: s.description, parameters: s.parameters }
    }))
    if (this.history.length === 0) this.history.push({ role: 'system', content: input.systemPrompt })
    this.history.push({ role: 'user', content: input.prompt })
    const { url, headers, model, label } = this.target()

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        signal: input.signal,
        body: JSON.stringify({ model, stream: true, messages: this.history, tools })
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`${label} request failed (${res.status}): ${detail.slice(0, 300)}`)
      }
      if (!res.body) throw new Error(`${label} returned no response body`)

      let text = ''
      const calls = new Map<number, { id: string; name: string; args: string }>()
      for await (const data of sseData(res.body)) {
        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
            }
          }>
        }
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content
          yield { kind: 'text-delta', text: delta.content }
        }
        for (const tc of delta.tool_calls ?? []) {
          const slot = calls.get(tc.index) ?? { id: '', name: '', args: '' }
          if (tc.id) slot.id = tc.id
          if (tc.function?.name) slot.name += tc.function.name
          if (tc.function?.arguments) slot.args += tc.function.arguments
          calls.set(tc.index, slot)
        }
      }

      if (calls.size === 0) {
        this.history.push({ role: 'assistant', content: text })
        yield { kind: 'done', sessionId: null, error: null }
        return
      }

      const ordered = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, c], i) => ({ ...c, id: c.id || `call_r${round}_${i}` }))
      this.history.push({
        role: 'assistant',
        content: text || null,
        tool_calls: ordered.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.args }
        }))
      })

      for (const call of ordered) {
        let parsed: Record<string, unknown> = {}
        let parseError: string | null = null
        if (call.args.trim()) {
          try {
            parsed = JSON.parse(call.args) as Record<string, unknown>
          } catch (err) {
            parseError = `Invalid JSON in tool arguments: ${err instanceof Error ? err.message : String(err)}`
          }
        }
        yield { kind: 'tool-start', id: call.id, name: call.name, input: parsed }
        const outcome = parseError
          ? { text: parseError, isError: true }
          : await gateAndRunTool(input.tools, call.name, parsed, input.confirm)
        yield { kind: 'tool-result', id: call.id, isError: outcome.isError, text: outcome.text }
        this.history.push({ role: 'tool', tool_call_id: call.id, content: outcome.text })
      }
      // Paragraph break so post-tool prose doesn't concatenate mid-word
      // (mirrors the Claude translator's content_block_start behavior).
      yield { kind: 'text-delta', text: '\n\n' }
    }
    yield {
      kind: 'done',
      sessionId: null,
      error: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds — the model may be stuck in a loop.`
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/providers/openaiCompat.test.ts`
Expected: PASS

- [ ] **Step 5: Register in the factory — `src/main/providers/index.ts`**

```ts
import type { ProviderAdapter, ProviderConfig, ProviderName } from './types'
import { ClaudeAdapter } from './claude'
import { OpenAIChatAdapter } from './openaiCompat'

export function createAdapter(
  provider: ProviderName,
  config: () => ProviderConfig
): ProviderAdapter {
  switch (provider) {
    case 'openai':
    case 'local':
      return new OpenAIChatAdapter(config)
    default:
      return new ClaudeAdapter(config)
  }
}
```

- [ ] **Step 6: Run all tests + typecheck, then commit**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS

```bash
git add src/main/providers/openaiCompat.ts src/main/providers/openaiCompat.test.ts src/main/providers/index.ts
git commit -m "feat: OpenAI-compatible adapter with streaming tool loop (OpenAI + local servers)"
```

---

### Task 7: GeminiAdapter

**Files:**
- Create: `src/main/providers/gemini.ts`
- Test: `src/main/providers/gemini.test.ts`

- [ ] **Step 1: Write the failing test `src/main/providers/gemini.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { GeminiAdapter, sanitizeForGemini } from './gemini'
import type { AgentEvent, ProviderConfig, TurnInput } from './types'

const echo = tool('echo_tool', 'Echoes.', { message: z.string() }, async (args: { message: string }) => ({
  content: [{ type: 'text' as const, text: `echo:${args.message}` }]
}))

function sseBody(events: unknown[]): Response {
  const payload = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function turnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    prompt: 'hello',
    systemPrompt: 'You are a test.',
    tools: [echo],
    confirm: vi.fn().mockResolvedValue(true),
    signal: new AbortController().signal,
    ...overrides
  }
}

const config: ProviderConfig = {
  provider: 'gemini',
  model: 'gemini-test',
  oauthToken: null,
  apiKey: 'AIza-test',
  endpoint: null
}

async function collect(adapter: GeminiAdapter, input: TurnInput): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const e of adapter.runTurn(input)) events.push(e)
  return events
}

describe('sanitizeForGemini', () => {
  it('keeps supported keywords and drops unsupported ones recursively', () => {
    const cleaned = sanitizeForGemini({
      type: 'object',
      $schema: 'http://x',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'd', additionalProperties: false }
      },
      required: ['name']
    })
    expect(cleaned).toEqual({
      type: 'object',
      properties: { name: { type: 'string', description: 'd' } },
      required: ['name']
    })
  })
})

describe('GeminiAdapter', () => {
  it('streams text and finishes cleanly', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseBody([
        { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'lo' }] } }] }
      ])
    )
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    expect(events).toEqual([
      { kind: 'text-delta', text: 'Hel' },
      { kind: 'text-delta', text: 'lo' },
      { kind: 'done', sessionId: null, error: null }
    ])
    const url = fetchFn.mock.calls[0][0] as string
    expect(url).toContain('gemini-test:streamGenerateContent')
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('AIza-test')
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.systemInstruction.parts[0].text).toBe('You are a test.')
    expect(body.tools[0].functionDeclarations[0].name).toBe('echo_tool')
  })

  it('executes a functionCall and loops back with a functionResponse', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseBody([
          {
            candidates: [
              { content: { parts: [{ functionCall: { name: 'echo_tool', args: { message: 'hi' } } }] } }
            ]
          }
        ])
      )
      .mockResolvedValueOnce(sseBody([{ candidates: [{ content: { parts: [{ text: 'done!' }] } }] }]))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    const events = await collect(adapter, turnInput())
    const start = events.find((e) => e.kind === 'tool-start')
    expect(start).toMatchObject({ name: 'echo_tool', input: { message: 'hi' } })
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool-result', isError: false, text: 'echo:hi' })
    )
    const second = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    const lastContent = second.contents[second.contents.length - 1]
    expect(lastContent.role).toBe('user')
    expect(lastContent.parts[0].functionResponse.name).toBe('echo_tool')
    expect(events[events.length - 1]).toEqual({ kind: 'done', sessionId: null, error: null })
  })

  it('throws a labeled error on a non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    await expect(collect(adapter, turnInput())).rejects.toThrow(/Gemini request failed \(403\)/)
  })

  it('keeps history across turns and clears on reset', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(sseBody([{ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }]))
    const adapter = new GeminiAdapter(() => config, fetchFn as unknown as typeof fetch)
    await collect(adapter, turnInput({ prompt: 'first' }))
    await collect(adapter, turnInput({ prompt: 'second' }))
    const body = JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user'])
    adapter.reset()
    await collect(adapter, turnInput({ prompt: 'third' }))
    const fresh = JSON.parse((fetchFn.mock.calls[2][1] as RequestInit).body as string)
    expect(fresh.contents.map((c: { role: string }) => c.role)).toEqual(['user'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/providers/gemini.test.ts`
Expected: FAIL — `Cannot find module './gemini'`

- [ ] **Step 3: Implement `src/main/providers/gemini.ts`**

```ts
import type { AgentEvent, ProviderAdapter, ProviderConfig, TurnInput } from './types'
import { toToolSpecs, gateAndRunTool } from './toolSchema'
import { sseData } from './sse'

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

const MAX_TOOL_ROUNDS = 25

/** Keys Gemini's OpenAPI-flavored schema accepts; everything else is dropped. */
const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'nullable',
  'anyOf',
  'minimum',
  'maximum',
  'minItems',
  'maxItems'
])

export function sanitizeForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        props[name] = sanitizeForGemini(sub as Record<string, unknown>)
      }
      out.properties = props
    } else if ((key === 'items' || key === 'anyOf') && value && typeof value === 'object') {
      out[key] = Array.isArray(value)
        ? value.map((v) => sanitizeForGemini(v as Record<string, unknown>))
        : sanitizeForGemini(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

export class GeminiAdapter implements ProviderAdapter {
  private history: GeminiContent[] = []
  private callSeq = 0

  constructor(
    private readonly config: () => ProviderConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  reset(): void {
    this.history = []
    this.callSeq = 0
  }

  async *runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
    const cfg = this.config()
    const model = cfg.model || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
    const tools = [
      {
        functionDeclarations: toToolSpecs(input.tools).map((s) => ({
          name: s.name,
          description: s.description,
          parameters: sanitizeForGemini(s.parameters)
        }))
      }
    ]
    this.history.push({ role: 'user', parts: [{ text: input.prompt }] })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey ?? '' },
        signal: input.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: this.history,
          tools
        })
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Gemini request failed (${res.status}): ${detail.slice(0, 300)}`)
      }
      if (!res.body) throw new Error('Gemini returned no response body')

      const modelParts: GeminiPart[] = []
      const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
      for await (const data of sseData(res.body)) {
        let chunk: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) {
            modelParts.push({ text: part.text })
            yield { kind: 'text-delta', text: part.text }
          }
          if (part.functionCall) {
            modelParts.push({ functionCall: part.functionCall })
            calls.push({
              id: `gcall_${this.callSeq++}`, // Gemini calls carry no id; synthesize for the UI
              name: part.functionCall.name,
              args: part.functionCall.args ?? {}
            })
          }
        }
      }
      this.history.push({ role: 'model', parts: modelParts.length > 0 ? modelParts : [{ text: '' }] })

      if (calls.length === 0) {
        yield { kind: 'done', sessionId: null, error: null }
        return
      }

      const responses: GeminiPart[] = []
      for (const call of calls) {
        yield { kind: 'tool-start', id: call.id, name: call.name, input: call.args }
        const outcome = await gateAndRunTool(input.tools, call.name, call.args, input.confirm)
        yield { kind: 'tool-result', id: call.id, isError: outcome.isError, text: outcome.text }
        responses.push({
          functionResponse: {
            name: call.name,
            response: outcome.isError ? { error: outcome.text } : { result: outcome.text }
          }
        })
      }
      this.history.push({ role: 'user', parts: responses })
      yield { kind: 'text-delta', text: '\n\n' }
    }
    yield {
      kind: 'done',
      sessionId: null,
      error: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds — the model may be stuck in a loop.`
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/providers/gemini.test.ts`
Expected: PASS

- [ ] **Step 5: Register in the factory**

In `src/main/providers/index.ts`, add `import { GeminiAdapter } from './gemini'` and the case:

```ts
    case 'gemini':
      return new GeminiAdapter(config)
```

- [ ] **Step 6: Run all tests + typecheck, then commit**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS

```bash
git add src/main/providers/gemini.ts src/main/providers/gemini.test.ts src/main/providers/index.ts
git commit -m "feat: Gemini adapter with function-calling tool loop"
```

---

### Task 8: Main-process wiring + IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Wire `providerConfig()` in `src/main/index.ts`**

Add imports at the top:

```ts
import type { ProviderConfig, ProviderName } from './providers/types'
```

Inside `app.whenReady().then(async () => {` (after the `buildGw2` definition, before `new AgentService`), add:

```ts
  const PROVIDER_MODEL_SETTING: Record<ProviderName, SettingKey> = {
    claude: 'model',
    gemini: 'geminiModel',
    openai: 'openaiModel',
    local: 'localModel'
  }
  const providerConfig = (): ProviderConfig => {
    const provider = (store.getSetting('provider') ?? 'claude') as ProviderName
    return {
      provider,
      model: store.getSetting(PROVIDER_MODEL_SETTING[provider]),
      oauthToken: store.getSecret('claudeOauthToken'),
      apiKey:
        provider === 'gemini' || provider === 'openai' ? store.getActiveKey(provider) : null,
      endpoint: store.getSetting('localEndpoint')
    }
  }
```

Then replace the temporary `config: () => ({ provider: 'claude' ... })` block from Task 4 with:

```ts
    config: providerConfig,
```

- [ ] **Step 2: Add `local:status` and `provider:status` IPC handlers**

Add after the `axitools:status` handler in `src/main/index.ts`:

```ts
  // Probe the local model server: Ollama's /api/tags first, then the
  // OpenAI-compatible /v1/models (LM Studio, llama.cpp server).
  ipcMain.handle('local:status', async () => {
    const base = (store.getSetting('localEndpoint') || 'http://localhost:11434').replace(/\/+$/, '')
    try {
      const res = await fetch(`${base}/api/tags`)
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        return { ok: true, models: (data.models ?? []).map((m) => m.name) }
      }
    } catch {
      // not Ollama — try the OpenAI-compatible listing below
    }
    try {
      const res = await fetch(`${base}/v1/models`)
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> }
        return { ok: true, models: (data.data ?? []).map((m) => m.id) }
      }
      return { ok: false, error: `Local server responded ${res.status}` }
    } catch {
      return {
        ok: false,
        error:
          'No local model server found. Install Ollama from ollama.com, then run: ollama pull qwen3:8b'
      }
    }
  })

  // Credential readiness for the selected provider — drives the first-run nudge.
  ipcMain.handle('provider:status', () => {
    const cfg = providerConfig()
    switch (cfg.provider) {
      case 'gemini':
        return {
          provider: cfg.provider,
          ready: cfg.apiKey !== null,
          note: cfg.apiKey ? null : 'Add a Gemini API key in Settings to file dispatches.'
        }
      case 'openai':
        return {
          provider: cfg.provider,
          ready: cfg.apiKey !== null,
          note: cfg.apiKey ? null : 'Add an OpenAI API key in Settings to file dispatches.'
        }
      case 'local':
        return {
          provider: cfg.provider,
          ready: true,
          note: 'Local models are slower and less reliable on multi-step tasks.'
        }
      default:
        return {
          provider: cfg.provider,
          ready: true,
          note: cfg.oauthToken
            ? null
            : "Using this machine's Claude Code login — file a token in Settings if dispatches fail."
        }
    }
  })
```

- [ ] **Step 3: Expose in `src/preload/index.ts`**

Add inside the `exposeInMainWorld('officer', { ... })` object:

```ts
  localStatus: () => ipcRenderer.invoke('local:status'),
  providerStatus: () => ipcRenderer.invoke('provider:status'),
```

- [ ] **Step 4: Update `src/preload/index.d.ts`**

Widen the key-service unions on lines 19-22 from `'gw2' | 'axivale'` to `'gw2' | 'axivale' | 'gemini' | 'openai'`, and add to `OfficerApi`:

```ts
  localStatus(): Promise<{ ok: boolean; models?: string[]; error?: string }>
  providerStatus(): Promise<{
    provider: 'claude' | 'gemini' | 'openai' | 'local'
    ready: boolean
    note: string | null
  }>
```

- [ ] **Step 5: Run tests + typecheck, then commit**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: PASS

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: provider config wiring, local server probe, and provider status IPC"
```

---

### Task 9: Settings UI — Intelligence section

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx` (replace the "Claude" sgroup, lines 214-251)

No component test harness exists in this repo; verification is typecheck + manual dev run.

- [ ] **Step 1: Pin the curated model lists**

Use WebFetch/WebSearch to confirm the current public model ids for Gemini and OpenAI chat APIs (spec requires verifying, not trusting memory). Then define at the top of `Settings.tsx` (module scope, below the interfaces), substituting verified ids if they differ:

```ts
type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'

const PROVIDERS: Array<{ value: ProviderName; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'local', label: 'Local' }
]

// Verified against provider docs at implementation time.
const GEMINI_MODELS = [
  { value: '', label: 'Default' },
  { value: 'gemini-2.5-flash', label: 'Flash' },
  { value: 'gemini-2.5-pro', label: 'Pro' }
]
const OPENAI_MODELS = [
  { value: '', label: 'Default' },
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini' }
]
const MODEL_SETTING: Record<ProviderName, string> = {
  claude: 'model',
  gemini: 'geminiModel',
  openai: 'openaiModel',
  local: 'localModel'
}
```

- [ ] **Step 2: Add provider state + handlers to the `Settings` component**

Add state alongside the existing Claude state:

```ts
  // Provider
  const [provider, setProvider] = useState<ProviderName>('claude')
  const [geminiModel, setGeminiModel] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [customModel, setCustomModel] = useState('')

  // Gemini / OpenAI keyrings
  const [geminiKeys, setGeminiKeys] = useState<KeyLabel[]>([])
  const [openaiKeys, setOpenaiKeys] = useState<KeyLabel[]>([])
  const [llmLabel, setLlmLabel] = useState('')
  const [llmKey, setLlmKey] = useState('')

  // Local
  const [localEndpoint, setLocalEndpoint] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localStatus, setLocalStatus] = useState<{ msg: string; ok: boolean } | null>(null)
```

Extend `refreshKeyLists` to also load the new rings:

```ts
    setGeminiKeys(await window.officer.listKeys('gemini'))
    setOpenaiKeys(await window.officer.listKeys('openai'))
```

Extend the mount `useEffect` to load the new settings:

```ts
      setProvider(((await window.officer.getSetting('provider')) as ProviderName) ?? 'claude')
      setGeminiModel((await window.officer.getSetting('geminiModel')) ?? '')
      setOpenaiModel((await window.officer.getSetting('openaiModel')) ?? '')
      setLocalEndpoint((await window.officer.getSetting('localEndpoint')) ?? '')
      setLocalModel((await window.officer.getSetting('localModel')) ?? '')
```

Add handlers:

```ts
  async function pickProvider(value: ProviderName): Promise<void> {
    setProvider(value)
    await window.officer.setSetting('provider', value)
    if (value === 'local') await checkLocal()
    onChanged()
  }

  async function pickProviderModel(p: ProviderName, value: string): Promise<void> {
    if (p === 'gemini') setGeminiModel(value)
    else if (p === 'openai') setOpenaiModel(value)
    else if (p === 'local') setLocalModel(value)
    else setModel(value)
    await window.officer.setSetting(MODEL_SETTING[p], value)
    onChanged()
  }

  async function addLlmKey(service: 'gemini' | 'openai'): Promise<void> {
    await window.officer.addKey(service, llmLabel.trim() || 'unnamed', llmKey)
    setLlmLabel('')
    setLlmKey('')
    await refreshKeyLists()
    onChanged()
  }

  async function activateLlmKey(service: 'gemini' | 'openai', label: string): Promise<void> {
    await window.officer.setActiveKey(service, label)
    await refreshKeyLists()
    onChanged()
  }

  async function removeLlmKey(service: 'gemini' | 'openai', label: string): Promise<void> {
    await window.officer.removeKey(service, label)
    await refreshKeyLists()
    onChanged()
  }

  async function saveLocalEndpoint(): Promise<void> {
    await window.officer.setSetting('localEndpoint', localEndpoint.trim())
    await checkLocal()
    onChanged()
  }

  async function checkLocal(): Promise<void> {
    setLocalStatus({ msg: 'probing…', ok: true })
    const res = await window.officer.localStatus()
    if (res.ok) {
      setLocalModels(res.models ?? [])
      setLocalStatus({
        msg: res.models?.length
          ? `connected · ${res.models.length} model${res.models.length === 1 ? '' : 's'}`
          : 'connected · no models installed — run: ollama pull qwen3:8b',
        ok: true
      })
    } else {
      setLocalModels([])
      setLocalStatus({ msg: res.error ?? 'no local server', ok: false })
    }
  }
```

- [ ] **Step 3: Replace the "Claude" sgroup JSX (lines 214-251) with the Intelligence section**

```tsx
      <div className="sgroup">
        <h2>Intelligence</h2>
        <label className="slabel">Provider</label>
        <div className="picker">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              className={`pi${provider === p.value ? ' sel' : ''}`}
              onClick={() => pickProvider(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {provider === 'claude' && (
          <>
            <label className="slabel">OAuth token</label>
            <input
              className="sinput"
              type="password"
              value={claudeToken}
              placeholder={claudeSaved ? '•••••••• (saved)' : 'paste setup token'}
              onChange={(e) => setClaudeToken(e.target.value)}
            />
            <p className="shelp">
              Run <code>claude setup-token</code> in a terminal and paste the result. Leave empty to
              use this machine's existing Claude Code login.
            </p>
            <div className="srow">
              <button className="sbtn" disabled={!claudeToken} onClick={saveClaude}>
                File token
              </button>
            </div>
            <div className="sstatus ok">
              {claudeStatus || (claudeSaved ? 'token saved' : 'system login')}
            </div>
            <label className="slabel">Model</label>
            <div className="picker">
              {[
                { value: '', label: 'Default' },
                { value: 'haiku', label: 'Haiku' },
                { value: 'sonnet', label: 'Sonnet' },
                { value: 'opus', label: 'Opus' }
              ].map((m) => (
                <button
                  key={m.value}
                  className={`pi${model === m.value ? ' sel' : ''}`}
                  onClick={() => pickProviderModel('claude', m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}

        {(provider === 'gemini' || provider === 'openai') && (
          <>
            <label className="slabel">API keys</label>
            <Keyring
              keys={provider === 'gemini' ? geminiKeys : openaiKeys}
              onActivate={(label) => activateLlmKey(provider, label)}
              onRemove={(label) => removeLlmKey(provider, label)}
            />
            <input
              className="sinput"
              type="text"
              value={llmLabel}
              placeholder="label, e.g. personal"
              onChange={(e) => setLlmLabel(e.target.value)}
            />
            <input
              className="sinput"
              type="password"
              value={llmKey}
              placeholder={provider === 'gemini' ? 'paste Gemini API key' : 'paste OpenAI API key'}
              onChange={(e) => setLlmKey(e.target.value)}
            />
            <p className="shelp">
              {provider === 'gemini' ? (
                <>Create a free key at aistudio.google.com → Get API key.</>
              ) : (
                <>Create a key at platform.openai.com → API keys.</>
              )}
            </p>
            <div className="srow">
              <button className="sbtn" disabled={!llmKey} onClick={() => addLlmKey(provider)}>
                Add key
              </button>
            </div>
            <label className="slabel">Model</label>
            <div className="picker">
              {(provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS).map((m) => (
                <button
                  key={m.value}
                  className={`pi${(provider === 'gemini' ? geminiModel : openaiModel) === m.value ? ' sel' : ''}`}
                  onClick={() => pickProviderModel(provider, m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <input
              className="sinput"
              type="text"
              value={customModel}
              placeholder="or type a custom model id and press Enter"
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customModel.trim()) {
                  void pickProviderModel(provider, customModel.trim())
                  setCustomModel('')
                }
              }}
            />
          </>
        )}

        {provider === 'local' && (
          <>
            <label className="slabel">Server</label>
            <input
              className="sinput"
              type="text"
              value={localEndpoint}
              placeholder="http://localhost:11434"
              onChange={(e) => setLocalEndpoint(e.target.value)}
            />
            <div className="srow">
              <button className="sbtn" onClick={saveLocalEndpoint}>
                Save &amp; probe
              </button>
            </div>
            {localStatus && (
              <div className={`sstatus ${localStatus.ok ? 'ok' : 'err'}`}>{localStatus.msg}</div>
            )}
            {localModels.length > 0 && (
              <>
                <label className="slabel">Model</label>
                <div className="picker">
                  {localModels.map((m) => (
                    <button
                      key={m}
                      className={`pi${localModel === m ? ' sel' : ''}`}
                      onClick={() => pickProviderModel('local', m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="shelp">
              Runs entirely on this machine — free, private, no API key. Install Ollama from
              ollama.com, then run <code>ollama pull qwen3:8b</code>. Local models are slower and
              less reliable on multi-step tasks than the cloud providers.
            </p>
          </>
        )}
      </div>
```

- [ ] **Step 4: Typecheck and manual verification**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run dev` — in Settings: switch between all four providers; add/remove a dummy Gemini key; probe Local with and without Ollama running (if not installed, expect the friendly error). Confirm the Claude block looks identical to before.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Settings.tsx
git commit -m "feat: provider picker with per-provider credentials and model selection in Settings"
```

---

### Task 10: First-run nudge in the chat empty state

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Track provider status in `App`**

Add state next to `claudeTokenSaved` (line 58):

```ts
  const [providerNote, setProviderNote] = useState<string | null>(null)
```

In `refreshStatus()` (after the `claudeTokenSaved` line), add:

```ts
    try {
      const status = await window.officer.providerStatus()
      setProviderNote(status.ready ? status.note : (status.note ?? 'Configure a provider in Settings.'))
    } catch {
      setProviderNote(null)
    }
```

- [ ] **Step 2: Render the nudge in the empty state**

Replace the empty-state div (App.tsx line 205):

```tsx
                <div className="empty">
                  No dispatches yet — file your orders below.
                  {providerNote && (
                    <>
                      <br />
                      {providerNote}{' '}
                      <button className="folio-act" onClick={() => setSection('settings')}>
                        Open Settings
                      </button>
                    </>
                  )}
                </div>
```

- [ ] **Step 3: Typecheck + manual verification, then commit**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run dev` — with provider set to gemini and no key, the empty state shows the nudge with a working Settings button; with claude + saved token, no note appears.

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: first-run provider setup nudge in the empty chat state"
```

---

### Task 11: Final verification + live smoke

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run --maxWorkers=2 && npm run typecheck`
Expected: all PASS

- [ ] **Step 2: Live smoke checklist (`npm run dev`)**

1. **Claude**: send "list our builds" — streaming text, tool coupons, confirm dialog on a destructive action. (Existing behavior, must be unregressed.)
2. **Gemini**: if the user has a key on hand, add it, pick Flash, send a prompt with a tool call; verify a destructive action still pops the confirm dialog and a declined confirm reports "The user declined this action."
3. **OpenAI**: same as Gemini if a key is available; otherwise verify a bogus key surfaces "OpenAI request failed (401)" in the article error notice.
4. **Local**: with Ollama absent, probe shows install instructions; if available, pull a small model and run a simple tool prompt.
5. **Provider switch**: switch providers mid-app — next dispatch starts a fresh conversation without errors; "New dispatch" still resets.

Steps 2-4 depend on which credentials the user has — report honestly which paths were exercised live vs. only by unit tests, and ask the user to smoke the rest.

- [ ] **Step 3: Final commit if any fixups, then report**

Summarize: what works, what was smoke-tested, known limitations (local model quality, no mid-session provider switching).
