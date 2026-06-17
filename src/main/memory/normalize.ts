//
// Pure helpers: body normalization for exact dedup, and cosine similarity for
// semantic dedup (metric-agnostic — computed in JS over stored vectors).

/** Lowercase, strip a leading bullet, drop a trailing parenthetical/bare date and
 *  trailing punctuation, collapse whitespace. Stable key for exact-dedup. */
export function normalizeMemoryBody(s: string): string {
  return s
    .replace(/^[\s*\-•]+/, '')
    .replace(/\s*\(?\b\d{4}-\d{2}-\d{2}\b\)?\s*$/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
