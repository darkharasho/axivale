import { describe, it, expect } from 'vitest'
import { resolveAsset } from './assets'

describe('resolveAsset', () => {
  it('resolves linux x64 to the tgz tarball and bin/ollama', () => {
    const a = resolveAsset('linux', 'x64')
    expect(a.url).toContain('ollama-linux-amd64.tgz')
    expect(a.archive).toBe('tgz')
    expect(a.binRelPath).toBe('bin/ollama')
  })

  it('resolves linux arm64', () => {
    expect(resolveAsset('linux', 'arm64').url).toContain('ollama-linux-arm64.tgz')
  })

  it('resolves win32 to the zip and ollama.exe', () => {
    const a = resolveAsset('win32', 'x64')
    expect(a.url).toContain('ollama-windows-amd64.zip')
    expect(a.archive).toBe('zip')
    expect(a.binRelPath).toBe('ollama.exe')
  })

  it('resolves darwin to the app zip', () => {
    const a = resolveAsset('darwin', 'arm64')
    expect(a.archive).toBe('zip')
    expect(a.binRelPath).toContain('ollama')
  })

  it('throws on an unsupported platform', () => {
    expect(() => resolveAsset('aix', 'x64')).toThrow(/unsupported/i)
  })
})
