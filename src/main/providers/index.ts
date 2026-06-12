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
