// src/main/meta/__evals__/agent/runAgentTurn.ts
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { AgentEvalCase, TurnTrace, ToolCallRecord } from './types'
import { resolveLiveConfig } from '../liveModel'
import { AgentService, type AgentDeps } from '../../../agent'
import type { ToolDeps } from '../../../tools/shared'
import type { AgentEvent, ProviderName, ProviderConfig, SessionState } from '../../../providers/types'
import { AxibridgeService } from '../../../axibridgeService'
import { AxibridgeClient } from '../../../axibridgeClient'
import { AxibridgeCache, DEFAULT_CACHE_CAP_BYTES, META_TTL_MS } from '../../../axibridgeCache'
import { listLinkedRepos } from '../../../axibridgeRepos'
import { summarizeResilient } from '../../../axibridgeSummarize'

export interface TurnRunner {
  runTurn(
    conversationId: string,
    prompt: string,
    onEvent: (e: AgentEvent) => void,
    opts?: { forcedSkillId?: string }
  ): Promise<void>
}

/** Subscribe to a turn's events and fold them into a TurnTrace. */
export async function foldTurn(runner: TurnRunner, prompt: string): Promise<TurnTrace> {
  let answer = ''
  let error: string | null = null
  const starts = new Map<string, { name: string; input: Record<string, unknown> }>()
  const toolCalls: ToolCallRecord[] = []

  await runner.runTurn('eval', prompt, (e) => {
    if (e.kind === 'text-delta') answer += e.text
    else if (e.kind === 'tool-start') starts.set(e.id, { name: e.name, input: e.input })
    else if (e.kind === 'tool-result') {
      const s = starts.get(e.id)
      toolCalls.push({
        name: s?.name ?? '(unknown)',
        input: s?.input ?? {},
        isError: e.isError,
        resultText: e.text
      })
    } else if (e.kind === 'done') error = e.error
  })

  return { answer, toolCalls, error }
}

function settingsDir(env: NodeJS.ProcessEnv): string {
  const p = env.AXIVALE_SETTINGS ?? join(homedir(), '.config', 'axivale', 'settings.json')
  return dirname(p)
}

function appSettings(env: NodeJS.ProcessEnv): Record<string, string> {
  const p = env.AXIVALE_SETTINGS ?? join(homedir(), '.config', 'axivale', 'settings.json')
  if (!existsSync(p)) return {}
  try {
    return (
      (JSON.parse(readFileSync(p, 'utf8')) as { settings?: Record<string, string> }).settings ?? {}
    )
  } catch {
    return {}
  }
}

/**
 * Build a real AxibridgeService for headless evals. Mirrors index.ts:488-505
 * but reads settings from disk (no Electron) and the GitHub PAT from
 * GITHUB_PAT (Electron safeStorage is unreadable here). The cache dir is the
 * app's real one, so cached reports are reused; summarizeResilient falls back
 * to inline summarizing when the worker bundle is absent (it is, in evals).
 */
export function buildEvalAxibridge(env: NodeJS.ProcessEnv = process.env): AxibridgeService {
  const s = appSettings(env)
  const client = new AxibridgeClient(() => env.GITHUB_PAT ?? null)
  const cache = new AxibridgeCache({
    dir: join(settingsDir(env), 'axibridge-cache'),
    capBytes: DEFAULT_CACHE_CAP_BYTES,
    ttlMs: META_TTL_MS
  })
  return new AxibridgeService({
    repos: () => listLinkedRepos(s.axibridgeRepos ?? null),
    client,
    cache,
    summarize: (jobs) => summarizeResilient(jobs),
    onProgress: () => {}
  })
}

/** ToolDeps with a real AxiBridge service and benign stubs for every other group. */
function buildEvalToolDeps(env: NodeJS.ProcessEnv): ToolDeps {
  const axibridge = buildEvalAxibridge(env)
  return {
    axitools: {} as never,
    axivaleServers: () => [],
    resolveAxitoolsServer: async () => {
      throw new Error('not wired in eval')
    },
    gw2: {} as never,
    discordGuildId: () => '',
    gw2GuildId: () => '',
    axiforge: {} as never,
    axiforgeLauncher: { ensureRunning: async () => {} },
    axibridge: () => axibridge,
    loadSkill: () => null,
    rosterAnnotations: () => [],
    rosterLinks: () => [],
    metaIndex: () => ({} as never),
    wikiIndex: () => ({} as never),
    generalIndex: () => ({} as never),
    memory: () => ({} as never),
    resolveEntityKey: async () => null,
    discordWebhookTie: () => ({ comp: [], build: [] }),
    wikiFacts: {} as never,
    fetchBuildPage: async () => null,
    fetchBuildPageRaw: async () => null,
    axilog: () => ({ watcher: {} as never, service: null })
  }
}

function buildConfig(c: AgentEvalCase, env: NodeJS.ProcessEnv): ProviderConfig {
  const live = resolveLiveConfig(env)
  return {
    provider: (c.provider ?? live.provider) as ProviderName,
    model: c.model ?? live.model,
    oauthToken: live.oauthToken,
    apiKey: env.EVAL_API_KEY ?? null,
    endpoint: env.EVAL_ENDPOINT ?? null
  }
}

/** A headless AgentService: real axibridge, stubbed rest, in-memory session, deny-confirm. */
export function buildEvalAgentService(
  c: AgentEvalCase,
  env: NodeJS.ProcessEnv = process.env
): AgentService {
  const toolDeps = buildEvalToolDeps(env)
  const sessions = new Map<string, SessionState>()
  const deps: AgentDeps = {
    toolDeps: () => toolDeps,
    config: () => buildConfig(c, env),
    confirm: async () => false,
    loadSession: (id) => sessions.get(id) ?? {},
    saveSession: (id, _provider, session) => {
      sessions.set(id, session)
    },
    skills: () => [],
    meta: () => [],
    pinnedMemory: () => []
  }
  return new AgentService(deps)
}

/** Run one case as a real turn (or via an injected runner) and return its trace. */
export async function runAgentTurn(c: AgentEvalCase, runner?: TurnRunner): Promise<TurnTrace> {
  const r = runner ?? buildEvalAgentService(c)
  return foldTurn(r, c.prompt)
}
