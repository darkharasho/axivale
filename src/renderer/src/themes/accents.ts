// src/renderer/src/themes/accents.ts
// The accent catalogue comes from the design package rather than being copied
// here: accents.json lives at the package root (not dist/) and is the same
// file the other axi apps read, so a new accent shipped upstream appears here
// with no AxiVale edit.
import accentsJson from '@axiapps/axi-design/accents.json'

export type AccentDefinition = { id: string; label: string; hex: string }

export const ACCENTS: AccentDefinition[] = accentsJson as AccentDefinition[]

/** crimson-red (#ef4444) is the nearest official accent to AxiVale's historic
 *  #c8423a — brighter and less brown, recognisably the same ink. */
export const DEFAULT_ACCENT_ID = 'crimson-red'

/** Names AxiVale may have stored before the accent system existed. */
const LEGACY_THEME_TO_ACCENT: Record<string, string> = {
  red: 'crimson-red',
  accent: 'crimson-red'
}

export function resolveAccentId(id?: string | null): string {
  if (id && ACCENTS.some((a) => a.id === id)) return id
  if (id && LEGACY_THEME_TO_ACCENT[id]) return LEGACY_THEME_TO_ACCENT[id]
  return DEFAULT_ACCENT_ID
}
