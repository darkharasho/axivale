// src/main/meta/model.ts
//
// One-shot Claude call for the distiller — no tools, cheap model. Reuses the
// app's Claude auth (saved OAuth token or system login via process.env). Any
// failure (incl. no auth) returns '' so the distiller no-ops and notes stay put.
import { query } from '@anthropic-ai/claude-agent-sdk'

export interface MetaModelConfig {
  oauthToken: string | null
  model: string
}

export async function runClaudeOnce(prompt: string, cfg: MetaModelConfig): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env }
  if (cfg.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = cfg.oauthToken
  try {
    let out = ''
    const q = query({ prompt, options: { model: cfg.model, env, allowedTools: [] } })
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') out += block.text
        }
      }
    }
    return out
  } catch {
    return ''
  }
}
