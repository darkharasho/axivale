import { describe, it, expect } from 'vitest'
import {
  AxilogWatcher,
  parseLogFilename,
  logIdForPath,
  defaultLogDirCandidates,
  hasLogExtension,
  resolveAxilogDir
} from './axilogWatcher'

/** In-memory fs + clock, so no test touches a real directory. */
function fakeFs(files: Record<string, number>) {
  const state = { ...files }
  return {
    state,
    api: {
      exists: (p: string) => Object.keys(state).some((f) => f.startsWith(p)),
      listFiles: (dir: string) =>
        Object.keys(state)
          .filter((f) => f.startsWith(dir))
          .map((f) => ({ path: f, bytes: state[f] })),
      statSize: (p: string) => state[p] ?? 0
    }
  }
}

describe('parseLogFilename', () => {
  it('reads the arcdps timestamp out of the filename', () => {
    expect(parseLogFilename('20260830-211432.zevtc')).toEqual({ startedAt: '2026-08-30T21:14:32' })
  })

  it('accepts .evtc and .evtc.zip alongside .zevtc', () => {
    expect(parseLogFilename('20260830-211432.evtc')).not.toBeNull()
    expect(parseLogFilename('20260830-211432.evtc.zip')).not.toBeNull()
  })

  it('rejects anything that is not an arcdps log', () => {
    expect(parseLogFilename('notes.txt')).toBeNull()
    expect(parseLogFilename('fight.zevtc')).toBeNull()
  })
})

describe('logIdForPath', () => {
  it('is stable across calls and distinct per path', () => {
    expect(logIdForPath('/a/b.zevtc')).toBe(logIdForPath('/a/b.zevtc'))
    expect(logIdForPath('/a/b.zevtc')).not.toBe(logIdForPath('/a/c.zevtc'))
    expect(logIdForPath('/a/b.zevtc')).toHaveLength(8)
  })
})

describe('defaultLogDirCandidates', () => {
  it('offers the Windows path and a Proton prefix path', () => {
    const candidates = defaultLogDirCandidates('/home/user')
    expect(candidates.some((c) => c.includes('arcdps.cbtlogs'))).toBe(true)
    expect(candidates.some((c) => c.includes('drive_c'))).toBe(true)
  })
})

describe('resolveAxilogDir', () => {
  it('prefers the configured folder over auto-detection', () => {
    const fs = { exists: (p: string) => p === '/detected' }
    expect(resolveAxilogDir('/configured', '/home/user', fs)).toBe('/configured')
  })

  it('falls back to detectLogDir when nothing is configured', () => {
    const fs = { exists: (p: string) => p.includes('arcdps.cbtlogs') }
    const home = '/home/user'
    expect(resolveAxilogDir(null, home, fs)).toBe(defaultLogDirCandidates(home)[0])
  })

  it('is null when neither is set', () => {
    const fs = { exists: () => false }
    expect(resolveAxilogDir(undefined, '/home/user', fs)).toBeNull()
  })

  it('treats an empty configured string as unset', () => {
    const fs = { exists: () => false }
    expect(resolveAxilogDir('', '/home/user', fs)).toBeNull()
  })
})

describe('hasLogExtension', () => {
  it('accepts the arcdps combat-log extensions and rejects everything else', () => {
    expect(hasLogExtension('/logs/20260830-211432.zevtc')).toBe(true)
    expect(hasLogExtension('/logs/a.evtc')).toBe(true)
    expect(hasLogExtension('/logs/a.evtc.zip')).toBe(true)
    expect(hasLogExtension('/logs/A.ZEVTC')).toBe(true)
    // A user-renamed drop is still a valid log by extension — no timestamp required.
    expect(hasLogExtension('/logs/myfight.zevtc')).toBe(true)
    expect(hasLogExtension('/etc/shadow')).toBe(false)
    expect(hasLogExtension('/logs/screenshot.png')).toBe(false)
    expect(hasLogExtension('/logs/a.zevtc.zip')).toBe(false)
  })
})

describe('AxilogWatcher', () => {
  const DIR = '/logs/World vs World'

  it('withholds a log whose size is still changing', () => {
    const fs = fakeFs({ [`${DIR}/20260830-211432.zevtc`]: 1000 })
    // 20260830-211432 + 8s, in local time (matches the local-time parse in scan()).
    const now = new Date(2026, 7, 30, 21, 14, 40).getTime()
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })

    expect(watcher.scan()).toEqual([])           // first sighting: size unconfirmed
    fs.state[`${DIR}/20260830-211432.zevtc`] = 2000
    expect(watcher.scan()).toEqual([])           // still growing
    expect(watcher.scan()).toHaveLength(1)       // stable across two scans
  })

  it('admits an old file immediately without waiting for a second scan', () => {
    const fs = fakeFs({ [`${DIR}/20260830-211432.zevtc`]: 1000 })
    // 20260830-211432 + 1h45m40s, in local time.
    const now = new Date(2026, 7, 30, 23, 0, 0).getTime()
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })
    expect(watcher.scan()).toHaveLength(1)
  })

  it('labels a fight with its containing folder', () => {
    const fs = fakeFs({ [`${DIR}/20260830-211432.zevtc`]: 1000 })
    const now = new Date(2026, 7, 30, 23, 0, 0).getTime()
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })
    expect(watcher.scan()[0].mapFolder).toBe('World vs World')
  })

  it('returns nothing, not an error, when no log dir is configured', () => {
    const fs = fakeFs({})
    const watcher = new AxilogWatcher({ dir: () => null, fs: fs.api, now: () => 0 })
    expect(watcher.scan()).toEqual([])
    expect(watcher.list()).toEqual([])
  })

  it('keeps opened files in the same registry as watched ones', () => {
    const fs = fakeFs({ '/elsewhere/20260830-201000.zevtc': 500 })
    const watcher = new AxilogWatcher({ dir: () => null, fs: fs.api, now: () => 0 })
    const entry = watcher.registerOpened('/elsewhere/20260830-201000.zevtc')
    expect(entry.source).toBe('opened')
    expect(watcher.resolve(entry.logId)).toEqual(entry)
    expect(watcher.list()).toHaveLength(1)
  })

  it('lists newest first and honours limit', () => {
    const fs = fakeFs({
      [`${DIR}/20260830-210000.zevtc`]: 100,
      [`${DIR}/20260830-220000.zevtc`]: 100,
      [`${DIR}/20260830-230000.zevtc`]: 100
    })
    const now = new Date(2026, 7, 31, 2, 0, 0).getTime()
    const watcher = new AxilogWatcher({ dir: () => '/logs', fs: fs.api, now: () => now })
    watcher.scan()
    const listed = watcher.list({ limit: 2 })
    expect(listed).toHaveLength(2)
    expect(listed[0].startedAt > listed[1].startedAt).toBe(true)
  })
})
