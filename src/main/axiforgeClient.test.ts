import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AddressInfo } from 'net'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AxiforgeClient, AxiforgeNotRunningError, AxiforgeError, forgeDataDir } from './axiforgeClient'

const TOKEN = 'test-token-123'

const FIXTURE_BUILDS = [
  { id: 'b1', title: 'Heal Firebrand', profession: 'Guardian', tags: ['wvw', 'support'], folderId: 'f1', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'b2', title: 'Power Reaper', profession: 'Necromancer', tags: [], folderId: null, updatedAt: '2026-06-02T00:00:00.000Z' }
]
const FIXTURE_COMPS = [{ id: 'c1', name: 'Zerg Comp', folderId: null, updatedAt: '2026-06-03T00:00:00.000Z' }]
const FIXTURE_FOLDERS = [{ id: 'f1', name: 'WvW' }]

let dataDir: string
let cacheDir: string
let cachePath: string
let server: Server | null = null
let requests: Array<{ method: string; url: string; auth: string | undefined; body: string }> = []

function startStub(routes: Record<string, { status?: number; json: unknown }>): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body })
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
        const route = routes[`${req.method} ${req.url}`]
        if (!route) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }
        res.writeHead(route.status ?? 200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(route.json))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port))
  })
}

function writeDiscovery(port: number, token = TOKEN): void {
  writeFileSync(
    join(dataDir, 'local-api.json'),
    JSON.stringify({ port, token, exePath: '/opt/AxiForge/axiforge', version: '1.4.0', pid: 4242 })
  )
}

function makeClient(opts?: { requestTimeoutMs?: number }): AxiforgeClient {
  return new AxiforgeClient({ dataDir, catalogCachePath: cachePath, ...opts })
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'axiforge-data-'))
  cacheDir = mkdtempSync(join(tmpdir(), 'axivale-cache-'))
  cachePath = join(cacheDir, 'axiforge-catalog.json')
  requests = []
  writeFileSync(join(dataDir, 'builds.json'), JSON.stringify(FIXTURE_BUILDS))
  writeFileSync(join(dataDir, 'comps.json'), JSON.stringify(FIXTURE_COMPS))
  writeFileSync(join(dataDir, 'folders.json'), JSON.stringify(FIXTURE_FOLDERS))
})

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => {
      // closeAllConnections available in Node 18.2+; keeps test from hanging on
      // the never-responding stub used in the timeout test.
      if (typeof (server as Server & { closeAllConnections?: () => void }).closeAllConnections === 'function') {
        (server as Server & { closeAllConnections: () => void }).closeAllConnections()
      }
      server!.close(() => r())
    })
  }
  server = null
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('forgeDataDir', () => {
  // AxiForge's Electron app name is "axiforge-desktop" (package.json name, no
  // top-level productName), so userData lives under that directory name.
  it('maps platforms to the AxiForge userData data dir', () => {
    expect(forgeDataDir('linux')).toMatch(/axiforge-desktop\/data$/)
    expect(forgeDataDir('darwin')).toContain(join('Library', 'Application Support', 'axiforge-desktop', 'data'))
    expect(forgeDataDir('win32')).toContain(join('axiforge-desktop', 'data'))
  })
})

describe('API path', () => {
  it('sends the bearer token from the discovery file', async () => {
    const port = await startStub({ 'GET /builds': { json: FIXTURE_BUILDS } })
    writeDiscovery(port)
    const builds = await makeClient().listBuilds()
    expect(builds.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(requests[0].auth).toBe(`Bearer ${TOKEN}`)
  })

  it('saveBuild POSTs the body and returns the saved build', async () => {
    const port = await startStub({ 'POST /builds': { json: { ...FIXTURE_BUILDS[0], title: 'Renamed' } } })
    writeDiscovery(port)
    const saved = await makeClient().saveBuild({ id: 'b1', title: 'Renamed' })
    expect(saved.title).toBe('Renamed')
    expect(JSON.parse(requests[0].body)).toMatchObject({ id: 'b1', title: 'Renamed' })
  })

  it('HTTP errors surface as AxiforgeError with the server message, not NotRunning', async () => {
    const port = await startStub({ 'POST /builds': { status: 422, json: { error: 'profession is required' } } })
    writeDiscovery(port)
    const err = await makeClient().saveBuild({ title: 'bad' }).catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err).not.toBeInstanceOf(AxiforgeNotRunningError)
    expect(err.message).toBe('profession is required')
  })

  it('publishBuild hits the publish endpoint', async () => {
    const port = await startStub({ 'POST /builds/b1/publish': { json: { url: 'https://axiforge.app/b/heal-fb' } } })
    writeDiscovery(port)
    const res = await makeClient().publishBuild('b1')
    expect(res).toMatchObject({ url: 'https://axiforge.app/b/heal-fb' })
  })

  it('buildChatLink hits the chat-link endpoint and returns the link', async () => {
    const port = await startStub({ 'POST /builds/b1/chat-link': { json: { chatLink: '[&DQE...]' } } })
    writeDiscovery(port)
    expect(await makeClient().buildChatLink('b1')).toEqual({ chatLink: '[&DQE...]' })
  })

  it('publishComp posts optional boonCoverageHtml; compPlaintext returns text', async () => {
    const port = await startStub({
      'POST /comps/c1/publish': { json: { url: 'https://axiforge.app/c/zerg' } },
      'GET /comps/c1/plaintext': { json: { text: 'Zerg Comp\nParty 1: ...' } }
    })
    writeDiscovery(port)
    const client = makeClient()
    await client.publishComp('c1', '<table/>')
    expect(JSON.parse(requests[0].body)).toEqual({ boonCoverageHtml: '<table/>' })
    expect(await client.compPlaintext('c1')).toEqual({ text: 'Zerg Comp\nParty 1: ...' })
  })

  it('importChatLink and importGw2skills post to the import endpoints', async () => {
    const port = await startStub({
      'POST /import/chat-link': { json: { id: 'b9', title: 'Imported' } },
      'POST /import/gw2skills': { json: { id: 'b10', title: 'Imported 2' } }
    })
    writeDiscovery(port)
    const client = makeClient()
    await client.importChatLink('[&DQE...]')
    await client.importGw2skills('http://gw2skills.net/editor/?abc')
    expect(JSON.parse(requests[0].body)).toEqual({ link: '[&DQE...]' })
    expect(JSON.parse(requests[1].body)).toEqual({ url: 'http://gw2skills.net/editor/?abc' })
  })

  it('import endpoints forward optional name/folderId/gameMode', async () => {
    const port = await startStub({ 'POST /import/chat-link': { json: { id: 'b9' } } })
    writeDiscovery(port)
    await makeClient().importChatLink('[&DQE...]', { name: 'My Build', folderId: 'f1', gameMode: 'wvw' })
    expect(JSON.parse(requests[0].body)).toEqual({
      link: '[&DQE...]',
      name: 'My Build',
      folderId: 'f1',
      gameMode: 'wvw'
    })
  })
})

describe('not-running detection and file fallback', () => {
  it('missing discovery file: writes throw AxiforgeNotRunningError', async () => {
    await expect(makeClient().deleteBuild('b1')).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('stale discovery file (connection refused): writes throw AxiforgeNotRunningError', async () => {
    const port = await startStub({ 'GET /health': { json: { ok: true, version: '1.4.0' } } })
    writeDiscovery(port)
    await new Promise((r) => server!.close(r))
    server = null
    await expect(makeClient().saveBuild({ title: 'x' })).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('reads fall back to the JSON files when the API is unreachable', async () => {
    const client = makeClient()
    expect((await client.listBuilds()).map((b) => b.id)).toEqual(['b1', 'b2'])
    expect((await client.getBuild('b2')).title).toBe('Power Reaper')
    expect((await client.listComps()).map((c) => c.id)).toEqual(['c1'])
    expect((await client.getComp('c1')).name).toBe('Zerg Comp')
    expect(await client.listFolders()).toEqual(FIXTURE_FOLDERS)
  })

  it('getBuild on a missing id in fallback mode throws a plain AxiforgeError', async () => {
    const err = await makeClient().getBuild('nope').catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeError)
    expect(err).not.toBeInstanceOf(AxiforgeNotRunningError)
    expect(err.message).toContain('nope')
  })

  it('getBuild when builds.json is absent throws AxiforgeNotRunningError', async () => {
    unlinkSync(join(dataDir, 'builds.json'))
    const err = await makeClient().getBuild('b1').catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeNotRunningError)
    expect(err.message).toContain('no local data found')
  })

  it('getComp when comps.json is absent throws AxiforgeNotRunningError', async () => {
    unlinkSync(join(dataDir, 'comps.json'))
    const err = await makeClient().getComp('c1').catch((e) => e)
    expect(err).toBeInstanceOf(AxiforgeNotRunningError)
    expect(err.message).toContain('no local data found')
  })
})

describe('fetch timeout', () => {
  it('listBuilds rejects with AxiforgeNotRunningError when the server never responds', async () => {
    // Start a server that accepts the connection but never sends a response
    const hangingSockets: import('net').Socket[] = []
    const hangingServer = await new Promise<Server>((resolve) => {
      const s = createServer((req: IncomingMessage, _res: ServerResponse) => {
        hangingSockets.push(req.socket)
        // Never call res.end — connection just hangs
      })
      s.listen(0, '127.0.0.1', () => resolve(s))
    })
    const port = (hangingServer.address() as AddressInfo).port
    writeDiscovery(port)

    try {
      // Use a very short timeout so the test runs fast.
      // deleteBuild has no file fallback, so the timeout directly surfaces as NotRunning.
      await expect(
        makeClient({ requestTimeoutMs: 200 }).deleteBuild('b1')
      ).rejects.toBeInstanceOf(AxiforgeNotRunningError)
    } finally {
      hangingSockets.forEach((s) => s.destroy())
      await new Promise<void>((r) => hangingServer.close(() => r()))
    }
  }, 5000)
})

describe('401 self-heal', () => {
  it('retries with fresh token after a 401 and succeeds on second request', async () => {
    // First request always 401s regardless of token; subsequent ones accept any auth.
    let callCount = 0
    const selfHealServer = await new Promise<Server>((resolve) => {
      const s = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          callCount++
          requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body })
          if (callCount === 1) {
            // First call always 401
            res.writeHead(401, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'unauthorized' }))
            return
          }
          // Subsequent calls succeed
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(FIXTURE_BUILDS))
        })
      })
      s.listen(0, '127.0.0.1', () => resolve(s))
    })

    const port = (selfHealServer.address() as AddressInfo).port
    writeDiscovery(port)

    try {
      const builds = await makeClient().listBuilds()
      expect(builds.map((b) => b.id)).toEqual(['b1', 'b2'])
      expect(callCount).toBe(2)
    } finally {
      await new Promise<void>((r) => selfHealServer.close(() => r()))
    }
  })
})

describe('catalog cache', () => {
  it('caches catalog responses and serves them when the API is down', async () => {
    const professions = [{ id: 'Guardian', name: 'Guardian' }]
    const port = await startStub({ 'GET /catalog/professions': { json: professions } })
    writeDiscovery(port)
    const client = makeClient()
    expect(await client.catalogProfessions()).toEqual(professions)
    expect(existsSync(cachePath)).toBe(true)

    await new Promise((r) => server!.close(r))
    server = null
    unlinkSync(join(dataDir, 'local-api.json'))
    expect(await makeClient().catalogProfessions()).toEqual(professions)
  })

  it('catalog with no cache and no API throws AxiforgeNotRunningError', async () => {
    await expect(makeClient().catalogUpgrades()).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('catalogProfession caches per id and game mode', async () => {
    const port = await startStub({
      'GET /catalog/professions/Guardian?gameMode=wvw': { json: { id: 'Guardian', specializations: [] } }
    })
    writeDiscovery(port)
    await makeClient().catalogProfession('Guardian', 'wvw')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache.entries['profession:Guardian:wvw']).toMatchObject({ id: 'Guardian' })
  })

  it('cache write failure is swallowed and fresh API data is still returned', async () => {
    // Point cachePath at a path that cannot be written: a file used as a directory
    const tmpFile = join(cacheDir, 'a-regular-file')
    writeFileSync(tmpFile, 'not a dir')
    const unwritableCachePath = join(tmpFile, 'sub', 'cache.json')

    const professions = [{ id: 'Guardian', name: 'Guardian' }]
    const port = await startStub({ 'GET /catalog/professions': { json: professions } })
    writeDiscovery(port)

    const client = new AxiforgeClient({ dataDir, catalogCachePath: unwritableCachePath })
    const result = await client.catalogProfessions()
    expect(result).toEqual(professions)
  })

  it('corrupt cache file is treated as empty (not a crash)', async () => {
    writeFileSync(cachePath, 'not valid json }{{{')
    // API also down, so it falls through to cache read
    await expect(makeClient().catalogUpgrades()).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('cache with wrong schemaVersion is ignored, resulting in NotRunning when API is down', async () => {
    // Write a cache with schemaVersion 2 (future/unknown)
    writeFileSync(cachePath, JSON.stringify({
      schemaVersion: 2,
      entries: { upgrades: [{ id: 'u1' }] },
      savedAt: new Date().toISOString()
    }))
    // API is down, cache should be rejected due to schema mismatch
    await expect(makeClient().catalogUpgrades()).rejects.toBeInstanceOf(AxiforgeNotRunningError)
  })

  it('written cache file includes schemaVersion: 1', async () => {
    const professions = [{ id: 'Guardian', name: 'Guardian' }]
    const port = await startStub({ 'GET /catalog/professions': { json: professions } })
    writeDiscovery(port)
    await makeClient().catalogProfessions()
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache.schemaVersion).toBe(1)
  })
})

describe('status', () => {
  it('reports connected when /health responds', async () => {
    const port = await startStub({ 'GET /health': { json: { ok: true, version: '1.4.0' } } })
    writeDiscovery(port)
    expect(await makeClient().status()).toEqual({ state: 'connected', version: '1.4.0' })
  })

  it('reports file-only when the API is down but data files exist', async () => {
    expect(await makeClient().status()).toEqual({ state: 'file-only' })
  })

  it('reports offline when neither the API nor data files exist', async () => {
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
    expect(await makeClient().status()).toEqual({ state: 'offline' })
  })
})
