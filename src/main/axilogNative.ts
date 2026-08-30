// The ONE place @axiapps/axilog is required. It is a napi native module: a
// missing or wrong-platform .node binary must degrade the AxiLog feature, never
// take the app down. Everything else in the codebase asks this module whether
// AxiLog is available and gets null, not an exception.

import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

/** Mirrors @axiapps/axilog's ParseOptions (all fields optional, camelCase). */
export interface AxilogParseOptions {
  replay?: boolean
  skillDamage?: boolean
  timeseries?: boolean
  missiles?: boolean
  rotation?: boolean
  modifiers?: boolean
  everything?: boolean
}

export interface AxilogNative {
  parseFile(path: string, opts?: AxilogParseOptions): unknown
}

let cached: AxilogNative | null = null
let reason: string | null = null
let attempted = false

/**
 * The native module, or null when it cannot be loaded. Never throws.
 *
 * `requireFn` defaults to a real `require('@axiapps/axilog')` and exists so
 * tests can inject a failing/malformed loader to exercise the degradation
 * path without depending on whether the real binary happens to be present
 * or absent on the machine running the test.
 */
export function loadAxilog(requireFn: () => unknown = () => nodeRequire('@axiapps/axilog')): AxilogNative | null {
  if (attempted) return cached
  attempted = true
  try {
    const mod = requireFn() as AxilogNative
    if (typeof mod?.parseFile !== 'function') {
      reason = '@axiapps/axilog loaded but exposes no parseFile'
      cached = null
      return null
    }
    cached = mod
    reason = null
    return cached
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err)
    cached = null
    return null
  }
}

/** Why the native module is unavailable, or null when it loaded fine. */
export function axilogUnavailableReason(): string | null {
  loadAxilog()
  return cached ? null : reason
}

/** Test-only: clears the memoized load result so a fresh loadAxilog() call re-runs. */
export function __resetAxilogForTest(): void {
  cached = null
  reason = null
  attempted = false
}
