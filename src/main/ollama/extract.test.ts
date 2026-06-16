import { describe, it, expect, vi } from 'vitest'

const spawnMock = vi.fn()
vi.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

import { tarArgs, extractArchive } from './extract'

function fakeProc(exitCode: number) {
  return {
    stderr: { on: vi.fn() },
    on: (event: string, cb: (arg?: number) => void) => {
      if (event === 'close') cb(exitCode)
    }
  }
}

describe('tarArgs', () => {
  it('uses -xzf for tgz', () => {
    expect(tarArgs('tgz', '/a.tgz', '/dest')).toEqual(['-xzf', '/a.tgz', '-C', '/dest'])
  })
  it('uses -xf for zip', () => {
    expect(tarArgs('zip', '/a.zip', '/dest')).toEqual(['-xf', '/a.zip', '-C', '/dest'])
  })
})

describe('extractArchive', () => {
  it('resolves when tar exits 0', async () => {
    spawnMock.mockReturnValueOnce(fakeProc(0))
    await expect(extractArchive('tgz', '/a.tgz', '/dest')).resolves.toBeUndefined()
    expect(spawnMock).toHaveBeenCalledWith('tar', ['-xzf', '/a.tgz', '-C', '/dest'], expect.anything())
  })

  it('rejects when tar exits non-zero', async () => {
    spawnMock.mockReturnValueOnce(fakeProc(2))
    await expect(extractArchive('zip', '/a.zip', '/dest')).rejects.toThrow(/exited with code 2/)
  })
})
