// src/renderer/src/themes/applyTheme.ts
import { DEFAULT_ACCENT_ID, resolveAccentId } from './accents'

/** The synchronous boot mirror. The settings store is the source of truth,
 *  but it answers over async IPC — long after first paint. Reading a mirrored
 *  copy here is what stops the window painting the default accent and then
 *  visibly flipping to the chosen one. */
export const ACCENT_STORAGE_KEY = 'axivale.accent'

let transitionTimer: ReturnType<typeof setTimeout> | null = null

/** Holds the crossfade class on <html> for the length of the transition so the
 *  whole window changes together. Shared by the accent and the surface:
 *  changing both at once should still be one fade. */
function crossfade(root: Element): void {
  root.classList.add('theme-transitioning')
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    root.classList.remove('theme-transitioning')
    transitionTimer = null
  }, 500)
}

/** Sets the accent on <html>, where accents.css's [data-axi-accent] rules
 *  hang, and mirrors it for the next boot. Storage failures are swallowed:
 *  a renderer with storage disabled should lose the mirror, not the window. */
export function applyTheme(id: string): void {
  crossfade(document.documentElement)
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

/** The synchronous boot mirror for the surface, for the same reason as the
 *  accent's: the settings store answers over async IPC, long after first paint. */
export const SURFACE_STORAGE_KEY = 'axivale.surface'

/** 'axi' is the language itself, drawn with no `data-axi-theme` at all. 'flat'
 *  and 'glass' are repaints of it shipped as
 *  `@axiapps/axi-design/themes/<id>.css`. */
export type SurfaceId = 'axi' | 'flat' | 'glass'

export const SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'axi', label: 'Axi' },
  { id: 'flat', label: 'Flat' },
  { id: 'glass', label: 'Glass' }
]

/** AxiVale has always been drawn in the language itself, so that stays the default. */
export const DEFAULT_SURFACE_ID: SurfaceId = 'axi'

/** Always returns one of the three ids. Membership is tested against the array
 *  rather than an object, so inherited property names are unknown values like
 *  any other. */
export function resolveSurfaceId(id?: string | null): SurfaceId {
  return SURFACES.some((s) => s.id === id) ? (id as SurfaceId) : DEFAULT_SURFACE_ID
}

export function readSurface(): SurfaceId {
  try {
    return resolveSurfaceId(localStorage.getItem(SURFACE_STORAGE_KEY))
  } catch {
    return DEFAULT_SURFACE_ID
  }
}

/** Sets the surface on <html> and mirrors it. 'axi' removes the attribute
 *  rather than naming itself: the language is not a theme layered over itself,
 *  and axi-design's own rule is that removing `data-axi-theme` leaves you back
 *  on it unchanged. */
export function applySurface(id: string): void {
  const resolved = resolveSurfaceId(id)
  const root = document.documentElement

  crossfade(root)

  if (resolved === 'axi') root.removeAttribute('data-axi-theme')
  else root.setAttribute('data-axi-theme', resolved)

  try {
    localStorage.setItem(SURFACE_STORAGE_KEY, resolved)
  } catch {
    /* no mirror this run; the store still holds the truth */
  }
}

/**
 * The surface's counterpart to applyAccent: optimistic, with rollback. Same
 * reasoning — the store is encrypted and answers over IPC, so waiting for the
 * round trip feels broken, and leaving the window on a surface the store does
 * not hold would silently revert at the next boot and read as forgetting.
 */
export async function applySurfaceSetting(
  id: string,
  previous: string,
  persist: (id: string) => Promise<unknown>
): Promise<string> {
  applySurface(id)
  try {
    await persist(id)
    return resolveSurfaceId(id)
  } catch {
    applySurface(previous)
    return resolveSurfaceId(previous)
  }
}
