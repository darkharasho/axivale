// src/main/shareViewerBundle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadViewerBundle } from './shareViewerBundle'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'viewer-'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('loadViewerBundle', () => {
  it('collects all files with forward-slash relative paths and base64 content', () => {
    const bundle = loadViewerBundle(dir)
    const paths = bundle.files.map((f) => f.path).sort()
    expect(paths).toEqual(['assets/app.js', 'index.html'])
    const idx = bundle.files.find((f) => f.path === 'index.html')!
    expect(Buffer.from(idx.base64, 'base64').toString('utf8')).toBe('<html></html>')
  })

  it('version is stable for identical content and changes when content changes', () => {
    const v1 = loadViewerBundle(dir).version
    expect(loadViewerBundle(dir).version).toBe(v1)
    writeFileSync(join(dir, 'index.html'), '<html>changed</html>')
    expect(loadViewerBundle(dir).version).not.toBe(v1)
  })

  it('throws a clear error when the viewer was never built', () => {
    expect(() => loadViewerBundle(join(dir, 'missing'))).toThrow(/share viewer/i)
  })
})
