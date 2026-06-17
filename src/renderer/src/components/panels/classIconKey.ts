/**
 * Candidate lookup keys for a class/elite-spec icon, most-specific first.
 *
 * The icon data is keyed by the bare canonical name ("necromancer", "reaper").
 * Real text adds noise the lookup must tolerate:
 *  - a "core " qualifier or "(core)" suffix on a base profession
 *    (e.g. "Core Necromancer" → "necromancer"), and
 *  - plurals in prose (e.g. "Spellbreakers", "Firebrands" → singular).
 * No canonical name ends in "s", so dropping a trailing "s" is unambiguous.
 */
export function classIconKeys(name: string): string[] {
  const base = name.trim().toLowerCase()
  const out: string[] = []
  const push = (v: string): void => {
    if (v && !out.includes(v)) out.push(v)
  }
  push(base)
  const noCore = base.replace(/^core\s+/, '').replace(/\s*\(core\)$/, '')
  push(noCore)
  if (noCore.endsWith('s')) push(noCore.slice(0, -1))
  return out
}

/** First candidate key that resolves in `data`, or null. */
export function lookupClassIcon(
  data: Record<string, string>,
  name: string | null | undefined
): string | null {
  if (!name) return null
  for (const key of classIconKeys(name)) {
    const hit = data[key]
    if (hit) return hit
  }
  return null
}
