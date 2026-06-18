// src/main/meta/__evals__/harness.ts
//
// Replay-by-default eval harness. In replay mode (the default, and what `npm test`
// runs) models/fetches are served from committed fixtures — offline, deterministic.
// EVAL_LIVE=1 hits real services; EVAL_RECORD=1 hits real services AND rewrites the
// fixture. Kept free of vitest imports so it can be used outside test files.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { MetaModel } from '../distill'

const HERE = dirname(fileURLToPath(import.meta.url))

export type EvalMode = 'replay' | 'live' | 'record'

export function evalMode(): EvalMode {
  if (process.env.EVAL_RECORD === '1') return 'record'
  if (process.env.EVAL_LIVE === '1') return 'live'
  return 'replay'
}

export function fixturePath(group: string, id: string, ext: string): string {
  return join(HERE, group, 'fixtures', `${id}.${ext}`)
}

export function loadFixture(group: string, id: string, ext: string): string | null {
  const p = fixturePath(group, id, ext)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

export function saveFixture(group: string, id: string, ext: string, data: string): void {
  const p = fixturePath(group, id, ext)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
}

/** A MetaModel backed by a fixture: replays in replay mode; calls `live` (and records
 *  in record mode) otherwise. Throws a clear, actionable error on a missing fixture. */
export function fixtureModel(group: string, id: string, live?: MetaModel): MetaModel {
  return async (prompt: string) => {
    const mode = evalMode()
    if (mode === 'replay') {
      const fix = loadFixture(group, id, 'txt')
      if (fix == null)
        throw new Error(`[eval] missing fixture for "${group}/${id}". Run: npm run eval:record`)
      return fix
    }
    if (!live) throw new Error(`[eval] ${mode} mode needs a live model for "${group}/${id}"`)
    const out = await live(prompt)
    if (mode === 'record') saveFixture(group, id, 'txt', out)
    return out
  }
}
