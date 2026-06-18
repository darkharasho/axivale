import type { ProviderAdapter, ProviderConfig, ProviderName } from './types'
import { ClaudeAdapter } from './claude'
import { OpenAIChatAdapter } from './openaiCompat'
import { GeminiAdapter } from './gemini'
import { CodexAdapter } from './codex'
import { GeminiCliAdapter } from './geminiCli'

export function createAdapter(
  provider: ProviderName,
  config: () => ProviderConfig
): ProviderAdapter {
  switch (provider) {
    case 'openai':
    case 'local':
      return new OpenAIChatAdapter(config)
    case 'gemini':
      return new GeminiAdapter(config)
    case 'codex':
      return new CodexAdapter(config)
    case 'antigravity':
      return new GeminiCliAdapter(config)
    default:
      return new ClaudeAdapter(config)
  }
}
