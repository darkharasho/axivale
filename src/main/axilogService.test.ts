import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AxilogService, MAX_LOG_BYTES } from './axilogService'
import { loadAxilog } from './axilogNative'

const FIXTURE = join(__dirname, '__fixtures__', 'wvw-small.anon.zevtc')
const WORKER = join(__dirname, '..', '..', 'out', 'main', 'axilogWorker.js')

let service: AxilogService | null = null
afterEach(() => {
  service?.dispose()
  service = null
})

describe('AxilogService', () => {
  it('rejects a path over the size ceiling without spawning a worker', async () => {
    service = new AxilogService({ workerPath: WORKER, statSize: () => MAX_LOG_BYTES + 1 })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/too large/i)
    expect(service.workerIsRunning()).toBe(false)
  })

  it('surfaces a missing file as an actionable message', async () => {
    service = new AxilogService({
      workerPath: WORKER,
      statSize: () => {
        throw new Error('ENOENT')
      }
    })
    await expect(service.overview('abc', '/nope/gone.zevtc')).rejects.toThrow(
      /log no longer at \/nope\/gone\.zevtc/
    )
  })

  it('reports the worker bundle missing rather than hanging', async () => {
    service = new AxilogService({ workerPath: '/nonexistent/axilogWorker.js', statSize: () => 10 })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/worker bundle/i)
  })

  it('times out a wedged parse and kills the worker', async () => {
    service = new AxilogService({
      workerPath: WORKER,
      statSize: () => 10,
      parseTimeoutMs: 50,
      spawn: () => ({
        postMessage: () => {},
        terminate: () => Promise.resolve(0),
        on: () => {}
      })
    })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/timed out after 50ms/)
    expect(service.workerIsRunning()).toBe(false)
  })

  // The one test that drives a REAL node:worker_threads worker end to end: it
  // covers the message handler, id correlation, the resolve branch and
  // armIdleKill(), and proves the built bundle actually loads as ESM under
  // worker_threads. It needs `npm run build` to have emitted out/main/
  // axilogWorker.js, and the @axiapps/axilog native binary; without either it
  // skips, the same way axilogWorker.test.ts does.
  const canRunReal = existsSync(WORKER) && loadAxilog() !== null
  const itReal = canRunReal ? it : it.skip

  itReal('parses the fixture through a real worker and reports the roster', async () => {
    service = new AxilogService({ workerPath: WORKER })
    const overview = await service.overview('fx', FIXTURE)
    expect(service.workerIsRunning()).toBe(true)
    expect(overview.roleCounts).toEqual({
      squad: 38,
      friendly_player: 4,
      enemy_player: 32,
      npc: 48
    })
    expect(Object.values(overview.roleCounts).reduce((a, b) => a + b, 0)).toBe(122)
    expect(overview.squad.length).toBe(38)
    service.dispose()
    expect(service.workerIsRunning()).toBe(false)
  })
})
