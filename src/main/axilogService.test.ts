import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { AxilogService, MAX_LOG_BYTES } from './axilogService'

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
        once: () => {},
        on: () => {},
        off: () => {}
      })
    })
    await expect(service.overview('abc', FIXTURE)).rejects.toThrow(/timed out after 50ms/)
    expect(service.workerIsRunning()).toBe(false)
  })
})
