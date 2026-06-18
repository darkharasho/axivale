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
import type { FetchLike } from '../snowcrows'

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

interface GearFixture {
  items: Record<string, { name: string; icon: string | null; type: string; details?: { type?: string } }>
  itemstats: Record<string, { name: string }>
}

const idsParam = (url: string): number[] =>
  (/[?&]ids=([^&]+)/.exec(url)?.[1] ?? '')
    .split(',')
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n))

const jsonResponse = (data: unknown) => ({
  ok: true,
  json: async () => data,
  text: async () => JSON.stringify(data)
})

/** A FetchLike that serves GW2 /v2/items and /v2/itemstats from a committed fixture,
 *  selecting entries by the request's ids= param. Replay-only by default; EVAL_LIVE
 *  passes through to the real (public, no-auth) GW2 API. */
export function fixtureFetch(group: string, id: string, live?: FetchLike): FetchLike {
  return async (url: string) => {
    if (evalMode() !== 'replay') {
      if (!live) throw new Error(`[eval] live/record fetch needs a real FetchLike for "${group}/${id}"`)
      return live(url)
    }
    const raw = loadFixture(group, id, 'json')
    if (raw == null)
      throw new Error(`[eval] missing fetch fixture "${group}/${id}". Hand-author <id>.json.`)
    const fix = JSON.parse(raw) as GearFixture
    const ids = idsParam(url)
    if (url.includes('/v2/itemstats'))
      return jsonResponse(ids.map((i) => ({ id: i, ...(fix.itemstats[String(i)] ?? { name: `stat-${i}` }) })))
    if (url.includes('/v2/items'))
      return jsonResponse(
        ids.map((i) => ({ id: i, ...(fix.items[String(i)] ?? { name: `item-${i}`, icon: null, type: 'Unknown' }) }))
      )
    return jsonResponse([])
  }
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
