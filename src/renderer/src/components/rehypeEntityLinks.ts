import { visitParents, SKIP } from 'unist-util-visit-parents'
import type { Root, Text, Element, ElementContent } from 'hast'

type EntityType = 'skill' | 'trait' | 'item'
interface EntityDictionaryEntry { name: string; type: EntityType; icon?: string }
interface EntityDictionary { entries: EntityDictionaryEntry[] }

const SKIP_PARENTS = new Set(['a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const MARKER = /\[\[(skill|trait|item):([^\]]+)\]\]/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function entitySpan(type: EntityType, name: string, label: string, icon?: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['axi-entity', `axi-entity--${type}`],
      'data-entity-type': type,
      'data-entity-name': name,
      ...(typeof icon === 'string' && icon.length > 0 ? { 'data-entity-icon': icon } : {})
    },
    children: [{ type: 'text', value: label }]
  }
}

interface CompiledDictionary {
  byName: Map<string, { type: EntityType; icon?: string }>
  textRe: RegExp | null
}

// Cache keyed by dictionary object identity; stores the compiled byName + textRe.
// Whether the text pass RUNS is determined at call time by the autoTextMatch flag —
// so one compiled entry is shared regardless of the flag.
const compiledCache = new WeakMap<EntityDictionary, CompiledDictionary>()

function compileDictionary(dictionary: EntityDictionary): CompiledDictionary {
  const cached = compiledCache.get(dictionary)
  if (cached) return cached

  // Longest-first so the alternation prefers the longest name; entries are pre-sorted but re-sort defensively.
  const entries = [...dictionary.entries].sort((a, b) => b.name.length - a.name.length)
  const byName = new Map(entries.map((e) => [e.name, { type: e.type, icon: e.icon }]))
  const textRe =
    entries.length > 0
      ? new RegExp(`(?<![\\w])(${entries.map((e) => escapeRe(e.name)).join('|')})(?![\\w])`, 'g')
      : null

  const compiled: CompiledDictionary = { byName, textRe }
  compiledCache.set(dictionary, compiled)
  return compiled
}

export function rehypeEntityLinks(opts: { dictionary: EntityDictionary; autoTextMatch?: boolean }) {
  const autoTextMatch = opts.autoTextMatch ?? false
  const { byName, textRe } = compileDictionary(opts.dictionary)

  return (tree: Root): void => {
    visitParents(tree, 'text', (node: Text, ancestors) => {
      if (ancestors.length === 0) return

      // Walk ALL ancestors — skip if any is a skip-zone tag or an axi-entity span (no double-wrap).
      for (const ancestor of ancestors) {
        if (ancestor.type !== 'element') continue
        const el = ancestor as Element
        if (SKIP_PARENTS.has(el.tagName)) return
        if (
          Array.isArray(el.properties?.className) &&
          (el.properties!.className as string[]).includes('axi-entity')
        ) return
      }

      const parent = ancestors[ancestors.length - 1] as Element
      const index = parent.children.indexOf(node)
      if (index === -1) return

      const out: ElementContent[] = []
      let cursor = 0
      const value = node.value

      // Marker pass takes priority: split the text on [[type:Name]] first, then run the
      // text matcher only on the plain segments between markers (and only if autoTextMatch is enabled).
      MARKER.lastIndex = 0
      let m: RegExpExecArray | null
      let lastMarkerEnd = 0
      const segments: Array<{ text: string } | { marker: [EntityType, string] }> = []
      while ((m = MARKER.exec(value))) {
        if (m.index > lastMarkerEnd) segments.push({ text: value.slice(lastMarkerEnd, m.index) })
        segments.push({ marker: [m[1] as EntityType, m[2].trim()] })
        lastMarkerEnd = m.index + m[0].length
      }
      if (lastMarkerEnd < value.length) segments.push({ text: value.slice(lastMarkerEnd) })

      let changed = false
      for (const seg of segments) {
        if ('marker' in seg) {
          const [type, name] = seg.marker
          const entry = byName.get(name)
          out.push(entitySpan(type, name, name, entry?.icon))
          changed = true
          continue
        }
        // Text pass: only runs when autoTextMatch is explicitly true
        if (!autoTextMatch || !textRe) {
          out.push({ type: 'text', value: seg.text })
          continue
        }
        textRe.lastIndex = 0
        cursor = 0
        let tm: RegExpExecArray | null
        let segChanged = false
        while ((tm = textRe.exec(seg.text))) {
          const name = tm[1]
          const entry = byName.get(name)
          if (!entry) continue
          if (tm.index > cursor) out.push({ type: 'text', value: seg.text.slice(cursor, tm.index) })
          out.push(entitySpan(entry.type, name, name, entry.icon))
          cursor = tm.index + name.length
          segChanged = true
        }
        if (segChanged) {
          if (cursor < seg.text.length) out.push({ type: 'text', value: seg.text.slice(cursor) })
          changed = true
        } else {
          out.push({ type: 'text', value: seg.text })
        }
      }

      if (!changed) return
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
