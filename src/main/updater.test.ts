import { describe, it, expect, vi } from 'vitest'
import { recreateMissingAppImage } from './updater'

function fsStub(exists: boolean, throwOnWrite = false): {
  existsSync: ReturnType<typeof vi.fn>
  writeFileSync: ReturnType<typeof vi.fn>
} {
  return {
    existsSync: vi.fn(() => exists),
    writeFileSync: vi.fn(() => {
      if (throwOnWrite) throw new Error('EACCES')
    })
  }
}

describe('recreateMissingAppImage', () => {
  const PATH = '/home/u/AppImages/AxiVale-0.11.1.AppImage'

  it('recreates an empty placeholder when the AppImage is missing on linux', () => {
    const fs = fsStub(false)
    expect(recreateMissingAppImage(PATH, 'linux', fs)).toBe('recreated')
    expect(fs.writeFileSync).toHaveBeenCalledWith(PATH, '')
  })

  it('does nothing when the AppImage still exists', () => {
    const fs = fsStub(true)
    expect(recreateMissingAppImage(PATH, 'linux', fs)).toBe('present')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('skips non-linux platforms (AppImage updater is linux-only)', () => {
    const fs = fsStub(false)
    expect(recreateMissingAppImage(PATH, 'darwin', fs)).toBe('skipped')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('skips when APPIMAGE is unset (not running as an AppImage)', () => {
    const fs = fsStub(false)
    expect(recreateMissingAppImage(undefined, 'linux', fs)).toBe('skipped')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('reports failure (never throws) when the placeholder cannot be written', () => {
    const fs = fsStub(false, true)
    expect(recreateMissingAppImage(PATH, 'linux', fs)).toBe('failed')
  })
})
