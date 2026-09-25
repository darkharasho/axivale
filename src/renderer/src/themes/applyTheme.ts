// src/renderer/src/themes/applyTheme.ts
import { DEFAULT_ACCENT_ID, resolveAccentId } from './accents'

/** The synchronous boot mirror. The settings store is the source of truth,
 *  but it answers over async IPC — long after first paint. Reading a mirrored
 *  copy here is what stops the window painting the default accent and then
 *  visibly flipping to the chosen one. */
export const ACCENT_STORAGE_KEY = 'axivale.accent'

/** Sets the accent on <html>, where accents.css's [data-axi-accent] rules
 *  hang, and mirrors it for the next boot. Storage failures are swallowed:
 *  a renderer with storage disabled should lose the mirror, not the window. */
export function applyTheme(id: string): void {
  const resolved = resolveAccentId(id)
  document.documentElement.setAttribute('data-axi-accent', resolved)
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, resolved)
  } catch {
    /* no mirror this run; the store still holds the truth */
  }
}

export function readAccent(): string {
  try {
    return resolveAccentId(localStorage.getItem(ACCENT_STORAGE_KEY))
  } catch {
    return DEFAULT_ACCENT_ID
  }
}

/**
 * Applies an accent optimistically and writes it through to the settings
 * store, rolling back if the store refuses.
 *
 * The optimism is the point: the store is encrypted and answers over IPC, and
 * a picker that waits for the round-trip feels broken. The rollback is the
 * other half — leaving the window showing an accent the store does not hold
 * would survive until the next boot and then silently revert, which reads as
 * the app forgetting rather than as the write having failed.
 *
 * Resolves to the accent that actually stands, so the caller can settle its
 * own state on it. Never rejects.
 */
export async function applyAccent(
  id: string,
  previous: string,
  persist: (id: string) => Promise<unknown>
): Promise<string> {
  applyTheme(id)
  try {
    await persist(id)
    return id
  } catch {
    applyTheme(previous)
    return previous
  }
}
