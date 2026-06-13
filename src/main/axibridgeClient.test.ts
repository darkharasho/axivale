import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { AxibridgeClient, AxibridgeError } from './axibridgeClient'

const repo = { owner: 'darkharasho', repo: 'eww-reports' }
let server: Server
let base: string
let requests: Array<{ url: string; auth: string | undefined }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', auth: req.headers.authorization })
    if (req.url === '/raw/darkharasho/eww-reports/main/reports/index.json') {
      res.end(
        JSON.stringify({
          entries: [
            { id: 'r1', title: 'Reset', dateStart: '2026-01-17', dateEnd: '2026-01-17', commanders: [] }
          ]
        })
      )
    } else if (req.url === '/raw/darkharasho/eww-reports/main/reports/rollup.json') {
      res.writeHead(404).end()
    } else if (req.url === '/pages/darkharasho/eww-reports/reports/rollup.json') {
      res.end(
        JSON.stringify({
          version: 1,
          sources: [],
          rollup: {
            commanderRows: [],
            playerRows: [],
            sourceReports: 0,
            uniqueRaids: 0,
            duplicateReportsCollapsed: 0,
            raidsSkippedMissingRequiredData: 0,
            reportsWithCommanderDetails: 0,
            reportsMissingCommanderDetails: 0,
            reportsWithAttendanceDetails: 0,
            reportsMissingAttendanceDetails: 0
          }
        })
      )
    } else if (req.url?.includes('rate-limited')) {
      res.writeHead(403).end('rate limit exceeded')
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})
afterAll(() => server.close())

function makeClient(pat: string | null = null): AxibridgeClient {
  return new AxibridgeClient(() => pat, {
    rawBase: (r, branch) => `${base}/raw/${r.owner}/${r.repo}/${branch}`,
    pagesBase: (r) => `${base}/pages/${r.owner}/${r.repo}`
  })
}

describe('AxibridgeClient', () => {
  it('fetches index.json from raw and normalizes {entries} vs array', async () => {
    const entries = await makeClient().fetchIndex(repo)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('r1')
  })
  it('sends the PAT as an Authorization header', async () => {
    requests = []
    await makeClient('ghp_tok').fetchIndex(repo)
    expect(requests[0].auth).toBe('Bearer ghp_tok')
  })
  it('falls back to the Pages URL when raw 404s', async () => {
    const rollup = await makeClient().fetchRollup(repo)
    expect(rollup).not.toBeNull()
    expect(rollup!.version).toBe(1)
  })
  it('returns null rollup when absent everywhere', async () => {
    const missing = { owner: 'darkharasho', repo: 'no-such' }
    await expect(makeClient().fetchRollup(missing)).resolves.toBeNull()
  })
  it('names the repo in not-found errors and keeps other repos unaffected', async () => {
    const missing = { owner: 'darkharasho', repo: 'no-such' }
    await expect(makeClient().fetchIndex(missing)).rejects.toMatchObject({
      code: 'not-found',
      message: expect.stringContaining('darkharasho/no-such')
    })
  })
  it('suggests adding a PAT on rate limits', async () => {
    const limited = { owner: 'darkharasho', repo: 'rate-limited' }
    await expect(makeClient().fetchIndex(limited)).rejects.toMatchObject({
      code: 'rate-limited',
      message: expect.stringContaining('PAT')
    })
  })
})
