// src/main/meta/publishDate.ts
//
// Content-side date extraction: the publish/last-modified date a page declares
// about ITSELF (not when AxiVale crawled it). Pulled from the robust, structured
// signals modern sites emit — JSON-LD dateModified/datePublished, OpenGraph
// `article:modified_time`/`article:published_time` (+ itemprop/last-modified)
// meta tags, and <time datetime>. We deliberately do NOT scrape visible "Updated:"
// prose — that's per-site and brittle; the distiller already harvests visible
// dates from page text. Pure + unit-tested.

// ISO-ish date (date, or date+time with optional zone). Date.parse handles the rest.
function* candidateDates(html: string): Generator<string> {
  // JSON-LD: "dateModified":"…" / "datePublished":"…"
  const ld = /"date(?:Modified|Published)"\s*:\s*"([^"]+)"/gi
  let m: RegExpExecArray | null
  while ((m = ld.exec(html)) !== null) yield m[1]

  // <meta …> carrying a modified/published/date key + a content date
  const meta = /<meta\b[^>]*>/gi
  while ((m = meta.exec(html)) !== null) {
    const tag = m[0]
    const key = (/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '').toLowerCase()
    if (!/modified|published|date|last-modified/.test(key)) continue
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (content) yield content
  }

  // <time datetime="…">
  const time = /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/gi
  while ((m = time.exec(html)) !== null) yield m[1]
}

const MIN_MS = Date.parse('2012-01-01') // GW2 launch — anything older is noise

/**
 * The newest credible self-declared date in `html`, as YYYY-MM-DD, or null when
 * the page declares none. Dates before GW2's launch or more than ~2 days in the
 * future (relative to `nowMs`) are treated as bogus and ignored.
 */
export function extractPublishDate(html: string, nowMs: number = Date.now()): string | null {
  if (!html) return null
  const maxMs = nowMs + 2 * 24 * 60 * 60 * 1000
  let best = -Infinity
  for (const raw of candidateDates(html)) {
    const ts = Date.parse(raw)
    if (!Number.isFinite(ts) || ts < MIN_MS || ts > maxMs) continue
    if (ts > best) best = ts
  }
  return best === -Infinity ? null : new Date(best).toISOString().slice(0, 10)
}

/** Newest of a set of date strings as YYYY-MM-DD, or undefined if none parse. */
export function newestDate(dates: Array<string | null | undefined>): string | undefined {
  let best = -Infinity
  for (const d of dates) {
    if (!d) continue
    const ts = Date.parse(d)
    if (Number.isFinite(ts) && ts > best) best = ts
  }
  return best === -Infinity ? undefined : new Date(best).toISOString().slice(0, 10)
}
