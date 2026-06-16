import os from 'os'

export interface HardwareInfo {
  totalRamGb: number
  recommendedModel: string
  modelOptions: string[]
}

const GB = 1024 ** 3

export function recommendModel(totalBytes: number): { recommended: string; options: string[] } {
  const gb = totalBytes / GB
  if (gb < 8) return { recommended: 'llama3.2:3b', options: ['llama3.2:3b', 'qwen3:8b'] }
  if (gb < 16) return { recommended: 'qwen3:8b', options: ['llama3.2:3b', 'qwen3:8b'] }
  return { recommended: 'qwen3:8b', options: ['llama3.2:3b', 'qwen3:8b', 'qwen3:14b'] }
}

export function detectHardware(): HardwareInfo {
  const totalBytes = os.totalmem()
  const { recommended, options } = recommendModel(totalBytes)
  return {
    totalRamGb: Math.round(totalBytes / GB),
    recommendedModel: recommended,
    modelOptions: options
  }
}
