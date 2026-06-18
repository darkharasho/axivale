import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { AxibridgeClient, AxibridgeError, downloadReport } from './axibridgeClient'

const repo = { owner: 'darkharasho', repo: 'eww-reports' }
let server: Server
let base: string
let requests: Array<{ url: string; auth: string | undefined }> = []
// Mid-stream route: fail (truncate after 10 of 100 bytes) for the first 2 hits,
// then serve the full body on the 3rd.
let flakyHits = 0
const fullBody = JSON.stringify({ meta: { id: 'flaky' }, pad: 'z'.repeat(80) })

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
    } else if (req.url === '/raw/darkharasho/eww-reports/main/reports/flaky/report.json') {
      // First two attempts: claim 100 bytes then truncate the socket at 10.
      if (flakyHits < 2) {
        flakyHits += 1
        res.writeHead(200, { 'Content-Length': '100' })
        res.write('0123456789')
        res.socket?.destroy() // abort mid-stream
        return
      }
      res.writeHead(200, { 'Content-Length': String(Buffer.byteLength(fullBody)) })
      res.end(fullBody)
    } else if (req.url === '/raw/darkharasho/eww-reports/main/reports/always-fail/report.json') {
      // Always truncate — exhausts all retry attempts.
      res.writeHead(200, { 'Content-Length': '100' })
      res.write('0123456789')
      res.socket?.destroy()
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

  it('surfaces a connection failure as a network AxibridgeError', async () => {
    const deadClient = new AxibridgeClient(() => null, {
      rawBase: (r, branch) => `http://127.0.0.1:1/raw/${r.owner}/${r.repo}/${branch}`,
      pagesBase: (r) => `http://127.0.0.1:1/pages/${r.owner}/${r.repo}`
    })
    await expect(deadClient.fetchIndex(repo)).rejects.toMatchObject({ code: 'network' })
  })

  it('does NOT send Authorization to the Pages URL but DOES send it to raw', async () => {
    // raw rollup.json returns 404, so fetchRollup falls through to the Pages URL.
    // We capture per-path headers to verify PAT isolation.
    requests = []
    const pat = 'ghp_isolation_test'
    await makeClient(pat).fetchRollup(repo)

    const rawRequests = requests.filter((r) => r.url.startsWith('/raw/'))
    const pagesRequests = requests.filter((r) => r.url.startsWith('/pages/'))

    // At least one raw attempt was made and it carried the PAT.
    expect(rawRequests.length).toBeGreaterThan(0)
    for (const r of rawRequests) {
      expect(r.auth).toBe(`Bearer ${pat}`)
    }

    // The Pages fallback must not carry the PAT.
    expect(pagesRequests.length).toBeGreaterThan(0)
    for (const r of pagesRequests) {
      expect(r.auth).toBeUndefined()
    }
  })
})

describe('downloadReport', () => {
  it('retries mid-stream failures with backoff and returns the full body', async () => {
    flakyHits = 0
    const progress: number[] = []
    const delays: number[] = []
    const body = await downloadReport(
      makeClient(),
      repo,
      'flaky',
      (p) => progress.push(p.receivedBytes),
      async (ms) => {
        delays.push(ms)
      }
    )
    expect(body).toBe(fullBody)
    expect(progress.length).toBeGreaterThan(0)
    // Two failed attempts → two backoff sleeps before the 2nd and 3rd attempts.
    expect(delays).toEqual([500, 1000])
  })

  it('throws a network AxibridgeError after exhausting retries', async () => {
    const delays: number[] = []
    await expect(
      downloadReport(
        makeClient(),
        { owner: 'darkharasho', repo: 'eww-reports' },
        'always-fail',
        () => {},
        async (ms) => {
          delays.push(ms)
        }
      )
    ).rejects.toMatchObject({ code: 'network' })
    expect(delays).toEqual([500, 1000])
  })
})
