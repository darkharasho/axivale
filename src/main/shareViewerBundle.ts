// src/main/shareViewerBundle.ts
//
// Reads the built share-viewer SPA (out/share-viewer) into a ViewerBundle for
// the publisher. The version marker is a content hash so the publisher re-pushes
// only when the viewer actually changes.

import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { ViewerBundle } from './sharePublisher'

function walk(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel))
    else out.push(rel)
  }
  return out
}

export function loadViewerBundle(dir: string): ViewerBundle {
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(
      'Share viewer not built. Run `npm run build:viewer` (or `npm run build`) before sharing.'
    )
  }
  const relPaths = walk(dir).sort()
  const hash = createHash('sha256')
  const files = relPaths.map((rel) => {
    const buf = readFileSync(join(dir, rel))
    hash.update(rel)
    hash.update(buf)
    return { path: rel, base64: buf.toString('base64') }
  })
  return { version: hash.digest('hex').slice(0, 12), files }
}
