// src/main/meta/__evals__/liveModel.ts
//
// The live/record-mode model, wired to the SAME source of truth the app uses:
// provider + model come from the app's settings.json (env-overridable). The OAuth
// token is encrypted by Electron safeStorage and unreadable from a headless test
// process, so it falls back to CLAUDE_CODE_OAUTH_TOKEN. Mirrors the meta refresher,
// which pins claude-sonnet-4-6 (faithful spec-name copying) — same default here.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runClaudeOnce } from '../model'
import type { MetaModel } from '../distill'

function settingsPath(env: NodeJS.ProcessEnv): string {
  // Electron app.getName() === package "name" ('axivale') → userData ~/.config/axivale.
  return env.AXIVALE_SETTINGS ?? join(homedir(), '.config', 'axivale', 'settings.json')
}

function appSettings(env: NodeJS.ProcessEnv): Record<string, string> {
  const p = settingsPath(env)
  if (!existsSync(p)) return {}
  try {
    return ((JSON.parse(readFileSync(p, 'utf8')) as { settings?: Record<string, string> }).settings) ?? {}
  } catch {
    return {}
  }
}

export interface LiveConfig {
  provider: string
  model: string
  oauthToken: string | null
}

export function resolveLiveConfig(env: NodeJS.ProcessEnv = process.env): LiveConfig {
  const s = appSettings(env)
  return {
    provider: env.EVAL_PROVIDER ?? s.provider ?? 'claude',
    model: env.EVAL_MODEL ?? s.claudeModel ?? 'claude-sonnet-4-6',
    oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN ?? null
  }
}

export function liveModel(): MetaModel {
  const cfg = resolveLiveConfig()
  if (cfg.provider !== 'claude')
    throw new Error(`[eval] live model only implements 'claude' (got '${cfg.provider}')`)
  return (prompt: string) => runClaudeOnce(prompt, { oauthToken: cfg.oauthToken, model: cfg.model })
}
