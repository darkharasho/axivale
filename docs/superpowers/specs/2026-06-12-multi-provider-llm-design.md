# Multi-Provider LLM Support — Design

**Date:** 2026-06-12
**Status:** Approved direction (explicit provider picker; Ollama for local), pending spec review

## Problem

AxiVale currently requires a Claude Code OAuth token (`@anthropic-ai/claude-agent-sdk`). End
users without a Claude subscription cannot use the app at all. We want them to be able to
bring a Gemini or OpenAI API key instead, and — with no API key at all — fall back to a
free local model served by Ollama (or any OpenAI-compatible local server).

## Goals

- User explicitly picks a provider in Settings: **Claude / Gemini / OpenAI / Local**.
- Gemini and OpenAI work with a user-supplied API key, stored encrypted like existing keys.
- Local mode talks to an OpenAI-compatible endpoint (default Ollama at
  `http://localhost:11434/v1`); the app detects it, lists installed models, and shows
  install instructions when absent.
- All providers drive the **same 24 officer tools** and the **same renderer event stream**
  (`AgentEvent`) — the UI layer is untouched except for Settings.
- The destructive-tool confirmation flow works identically on every provider.

## Non-Goals

- No automatic provider fallback or mid-session switching. Switching providers starts a
  new conversation.
- No bundled in-app model weights (`node-llama-cpp`). Possible later phase if users push
  back on installing Ollama.
- No per-provider prompt tuning beyond what's needed to make tool calling work.

## Architecture

### Provider adapter layer — `src/main/providers/`

`AgentService` (in `src/main/agent.ts`) stops calling `query()` directly and instead
delegates to a `ProviderAdapter` selected from settings:

```ts
interface ProviderAdapter {
  runTurn(input: {
    prompt: string
    systemPrompt: string
    tools: OfficerToolSpec[]                 // provider-neutral tool descriptions
    canUseTool: (name: string, input: Record<string, unknown>) => Promise<boolean>
    abort: AbortSignal
  }): AsyncGenerator<AgentEvent>
  reset(): void                              // clear conversation state
}
```

`AgentEvent` is the existing union (`text-delta | tool-start | tool-result | done`)
already consumed by the renderer; adapters emit it directly. The `done` event's
`sessionId` field becomes adapter-internal bookkeeping (nullable, as today).

### Adapters

**`ClaudeAdapter`** — extracts the existing `query()` + `createSdkMcpServer()` +
`translateSdkMessage()` code verbatim. Keeps SDK session resume (`resume: sessionId`)
for conversation continuity. Behavior is unchanged for current users.

**`OpenAIChatAdapter`** — direct `fetch()` to the OpenAI Chat Completions API (no SDK
dependency) with native function calling and SSE streaming. Runs its own agent loop:

1. Send messages + tool schemas; stream the response, emitting `text-delta` events.
2. If the response contains tool calls: for each, run the existing permission gate
   (`evaluateToolPermission` → confirm IPC for destructive tools), execute the tool
   handler from `tools.ts`, emit `tool-start` / `tool-result`, append the result message.
3. Repeat until a response has no tool calls; emit `done`.
4. A turn cap (e.g. 25 loop iterations) guards against runaway loops on weak models;
   hitting it emits `done` with an explanatory error.

Conversation history is held in-process by the adapter (array of provider messages),
cleared by `reset()`. This replaces the SDK's session-resume mechanism.

**`GeminiAdapter`** — same loop shape against the Gemini `generateContent` streaming
API with Gemini function declarations. Kept separate from the OpenAI adapter because
the wire formats differ (roles, function-call/response part types), but it shares the
loop helper where practical.

**`LocalAdapter`** — `OpenAIChatAdapter` with a configurable base URL (default
`http://localhost:11434/v1`) and no API key requirement. Anything speaking the
OpenAI-compatible protocol works: Ollama, LM Studio, llama.cpp server.

### Tool schema translation

`tools.ts` Zod definitions remain the single source of truth. A translator module
(`src/main/providers/toolSchema.ts`) derives `OfficerToolSpec` — name, description,
JSON Schema parameters via Zod 4's `z.toJSONSchema()` — consumed by the OpenAI and
Gemini adapters. The Claude adapter keeps using `createSdkMcpServer()` directly.
Tool *execution* (the handler functions and `ToolDeps`) is shared by all adapters.

### Settings & credentials

- New setting `provider`: `'claude' | 'gemini' | 'openai' | 'local'` (default `claude`
  for backward compatibility).
- The model dropdown becomes provider-scoped:
  - Claude: Default / Haiku / Sonnet / Opus (unchanged).
  - Gemini and OpenAI: a short curated list of current model ids plus a free-text
    custom field. Exact default ids are pinned at implementation time against each
    provider's current lineup (verify, don't trust memory).
  - Local: populated live from `GET /api/tags` on the Ollama endpoint; suggested
    pull is a small tool-calling-capable model (Qwen3-8B class).
- Keyring (`secrets.ts`) grows two services alongside `gw2`/`axivale`: `gemini` and
  `openai`, encrypted with `safeStorage` exactly like existing keys. Local mode needs
  no secret — just a `localEndpoint` setting (plain, in settings.json).
- Settings UI: provider picker at the top of the model section; below it, the
  credential/keyring block and model list for the selected provider only. For Local,
  a status row (endpoint reachable? models installed?) and, when Ollama is absent,
  short install instructions with the `ollama pull` command.

### First-run nudge

If the chosen provider has no usable credentials (no Claude token / no API key /
local endpoint unreachable), the chat pane shows a setup card pointing to Settings
listing the four options — replacing today's Claude-only empty state.

### Error handling

- Provider HTTP errors (401, 429, 5xx, network) surface through the existing `done`
  event's `error` field with a human-readable message naming the provider
  ("Gemini rejected the API key", "Ollama isn't running at localhost:11434").
- Abort (`agent:cancel`) cancels the in-flight `fetch` via the AbortSignal, same UX
  as today.
- Malformed tool-call JSON from weak local models: the adapter feeds a corrective
  tool-result message back ("invalid arguments: <zod error>") rather than crashing
  the turn; Zod validation runs before every tool handler regardless of provider.

### Degradation honesty

Selecting Local shows a one-time notice: local models are slower and noticeably less
reliable at multi-step tool work than the cloud options. If the 24-tool schema payload
proves too heavy for small models, trimming the tool list for Local is a tuning knob —
not designed in up front (YAGNI).

## Testing

- `toolSchema.test.ts` — Zod → JSON Schema translation for representative tools.
- Per-adapter tests mirroring `agentEvents.test.ts`: mock the HTTP/SSE stream, assert
  the emitted `AgentEvent` sequence, including the tool loop (call → confirm gate →
  execute → follow-up request) and the turn cap.
- `agent.test.ts` refactored to inject a fake adapter into `AgentService`; existing
  Claude translation tests move with the extracted code, unchanged.
- Manual smoke per provider against the live APIs (not CI).

## Implementation order

1. Extract `ClaudeAdapter` behind `ProviderAdapter`; `AgentService` becomes
   provider-agnostic. No behavior change — existing tests prove it.
2. Tool schema translator + shared agent-loop helper.
3. `OpenAIChatAdapter` + keyring/settings/UI for OpenAI.
4. `GeminiAdapter` + its keyring/settings entry.
5. `LocalAdapter` + Ollama detection UI + first-run nudge + degradation notice.
