import fs from 'fs'
import http from 'http'
import https from 'https'
import { spawn } from 'child_process'
import { URL } from 'url'
import { extractArchive } from './extract'
import type { OllamaDeps, ServeHandle } from './ollamaManager'

function download(url: string, dest: string, onPct: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      const lib = u.startsWith('https') ? https : http
      lib
        .get(u, { headers: { 'User-Agent': 'AxiVale' } }, (res) => {
          const code = res.statusCode || 0
          if ([301, 302, 307, 308].includes(code) && res.headers.location) {
            follow(res.headers.location)
            return
          }
          if (code >= 400) {
            reject(new Error(`HTTP ${code} downloading ${u}`))
            return
          }
          const total = parseInt(res.headers['content-length'] || '0', 10)
          let received = 0
          const file = fs.createWriteStream(dest)
          res.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total > 0) onPct(Math.round((received / total) * 100))
          })
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', (err) => {
            fs.unlink(dest, () => {})
            reject(err)
          })
        })
        .on('error', reject)
    }
    follow(url)
  })
}

function httpGetJson(url: string): Promise<{ models?: { name: string }[] }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => {
        data += c
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
  })
}

function httpPullStream(model: string, onLine: (line: string) => void, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${endpoint}/api/pull`)
    const body = JSON.stringify({ name: model, stream: true })
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (chunk: Buffer) => {
            errBody += chunk.toString()
          })
          res.on('end', () => {
            reject(new Error(`Ollama pull failed: HTTP ${res.statusCode} ${errBody.trim()}`.trim()))
          })
          return
        }
        let buf = ''
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString()
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            onLine(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
          }
        })
        res.on('end', () => {
          if (buf.trim()) onLine(buf)
          resolve()
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function spawnServe(binPath: string, endpoint: string): ServeHandle {
  const u = new URL(endpoint)
  const proc = spawn(binPath, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_HOST: `${u.hostname}:${u.port}`,
      // Raise the default context (4096) so AxiVale's large system-prompt +
      // tool-schema payload isn't truncated. The native /api/chat path also
      // sets num_ctx per-request; this is the floor for any other client.
      OLLAMA_CONTEXT_LENGTH: '16384'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  return proc as unknown as ServeHandle
}

export function createOllamaDeps(): OllamaDeps {
  return {
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync as OllamaDeps['mkdirSync'],
    rmSync: fs.rmSync as OllamaDeps['rmSync'],
    chmodSync: fs.chmodSync,
    download,
    extract: extractArchive,
    spawnServe,
    httpGet: httpGetJson,
    httpPullStream,
    platform: process.platform,
    arch: process.arch
  }
}
