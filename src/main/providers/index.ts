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
