// Strip raw JSON that occasionally leaks from a tool result into the agent's
// prose. The dispatch is a non-technical, reader-facing surface — a wall of
// {"member_id":...} must never reach it. Runs on the markdown source before
// rendering so it catches both fenced (```json) and bare object/array blobs.

/** A trimmed string that parses as a JSON object or array (not a bare scalar —
 *  we don't want to nuke a stray number or a quoted word in prose). */
function isJsonBlob(s: string): boolean {
  const t = s.trim()
  if (!/^[[{]/.test(t)) return false
  try {
    const v = JSON.parse(t)
    return typeof v === 'object' && v !== null
  } catch {
    return false
  }
}

const FENCE = /```[ \t]*([^\n`]*)\n([\s\S]*?)```/g

/** Entity-link marker the renderer understands: only these types resolve to a
 *  hover card (see rehypeEntityLinks). */
const KNOWN_ENTITY_TYPES = new Set(['skill', 'trait', 'item'])
const ENTITY_MARKER = /\[\[([a-zA-Z]+):([^\][]+)\]\]/g

/**
 * Normalize entity-link markers in the markdown source. Models (notably Gemini)
 * sometimes invent marker types the renderer doesn't support — `[[spec:Reaper]]`,
 * `[[boon:Alacrity]]` — which otherwise leak as literal `[[…]]` brackets because
 * the class-icon pass only rewrites the inner name. Strip any unsupported
 * `[[type:Name]]` down to bare `Name` (so a spec name still gets its auto class
 * icon and a boon renders as clean text), while leaving the supported
 * skill/trait/item markers intact for rehypeEntityLinks.
 */
export function normalizeEntityMarkers(md: string): string {
  if (!md) return md
  return md.replace(ENTITY_MARKER, (full, type: string, name: string) =>
    KNOWN_ENTITY_TYPES.has(type.toLowerCase()) ? full : name.trim()
  )
}

/**
 * Remove raw JSON from reader-facing markdown:
 *  - fenced blocks tagged json/jsonc, or whose body is a JSON object/array
 *  - bare paragraph blocks that are a JSON object/array
 * Everything else (prose, tables, build chatcodes, normal code) is untouched.
 */
export function stripRawJson(md: string): string {
  if (!md) return md
  let out = md.replace(FENCE, (match, lang: string, body: string) => {
    const tag = lang.trim().toLowerCase()
    if (tag === 'json' || tag === 'jsonc' || tag === 'json5' || isJsonBlob(body)) return ''
    return match
  })
  // Bare (unfenced) JSON blobs separated by blank lines.
  out = out
    .split(/\n\s*\n/)
    .filter((block) => !isJsonBlob(block))
    .join('\n\n')
  // Collapse the blank gaps left behind so the layout doesn't open up.
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
