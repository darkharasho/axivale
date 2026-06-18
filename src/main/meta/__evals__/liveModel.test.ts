import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLiveConfig, liveModel } from './liveModel'

const SETTINGS = join(tmpdir(), 'axivale-eval-settings.json')

afterEach(() => {
  if (existsSync(SETTINGS)) rmSync(SETTINGS)
  delete process.env.AXIVALE_SETTINGS
  delete process.env.EVAL_PROVIDER
  delete process.env.EVAL_MODEL
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
})

describe('resolveLiveConfig', () => {
  it('reads provider/model from app settings.json', () => {
    writeFileSync(SETTINGS, JSON.stringify({ settings: { provider: 'claude', claudeModel: 'claude-opus-4-8' } }))
    process.env.AXIVALE_SETTINGS = SETTINGS
    const cfg = resolveLiveConfig()
    expect(cfg.provider).toBe('claude')
    expect(cfg.model).toBe('claude-opus-4-8')
  })

  it('defaults to claude + sonnet when settings are absent', () => {
    process.env.AXIVALE_SETTINGS = join(tmpdir(), 'does-not-exist.json')
    const cfg = resolveLiveConfig()
    expect(cfg.provider).toBe('claude')
    expect(cfg.model).toBe('claude-sonnet-4-6')
  })

  it('env vars override settings; token comes from env', () => {
    writeFileSync(SETTINGS, JSON.stringify({ settings: { provider: 'claude', claudeModel: 'claude-sonnet-4-6' } }))
    process.env.AXIVALE_SETTINGS = SETTINGS
    process.env.EVAL_MODEL = 'claude-haiku-4-5-20251001'
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-123'
    const cfg = resolveLiveConfig()
    expect(cfg.model).toBe('claude-haiku-4-5-20251001')
    expect(cfg.oauthToken).toBe('tok-123')
  })
})

describe('liveModel', () => {
  it('throws for an unimplemented provider', () => {
    process.env.EVAL_PROVIDER = 'gemini'
    expect(() => liveModel()).toThrow(/only implements 'claude'/i)
  })
})
