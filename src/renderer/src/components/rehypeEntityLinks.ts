import { visit, SKIP } from 'unist-util-visit'
import type { Root, Text, Element, ElementContent } from 'hast'

type EntityType = 'skill' | 'trait' | 'item'
interface EntityDictionaryEntry { name: string; type: EntityType }
interface EntityDictionary { entries: EntityDictionaryEntry[] }

const SKIP_PARENTS = new Set(['a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const MARKER = /\[\[(skill|trait|item):([^\]]+)\]\]/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function entitySpan(type: EntityType, name: string, label: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['axi-entity', `axi-entity--${type}`],
      'data-entity-type': type,
      'data-entity-name': name
    },
    children: [{ type: 'text', value: label }]
  }
}

export function rehypeEntityLinks(opts: { dictionary: EntityDictionary }) {
  // Longest-first so the alternation prefers the longest name; entries are pre-sorted but re-sort defensively.
  const entries = [...opts.dictionary.entries].sort((a, b) => b.name.length - a.name.length)
  const byName = new Map(entries.map((e) => [e.name, e.type]))
  const textRe =
    entries.length > 0
      ? new RegExp(`(?<![\\w])(${entries.map((e) => escapeRe(e.name)).join('|')})(?![\\w])`, 'g')
      : null

  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return
      if (parent.type === 'element' && SKIP_PARENTS.has((parent as Element).tagName)) return

      // Skip text nodes that are already inside an axi-entity span (no double-wrap)
      if (
        parent.type === 'element' &&
        Array.isArray((parent as Element).properties?.className) &&
        ((parent as Element).properties!.className as string[]).includes('axi-entity')
      ) return

      const out: ElementContent[] = []
      let cursor = 0
      const value = node.value

      // Marker pass takes priority: split the text on [[type:Name]] first, then run the
      // text matcher only on the plain segments between markers.
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
          out.push(entitySpan(seg.marker[0], seg.marker[1], seg.marker[1]))
          changed = true
          continue
        }
        if (!textRe) {
          out.push({ type: 'text', value: seg.text })
          continue
        }
        textRe.lastIndex = 0
        cursor = 0
        let tm: RegExpExecArray | null
        let segChanged = false
        while ((tm = textRe.exec(seg.text))) {
          const name = tm[1]
          const type = byName.get(name)
          if (!type) continue
          if (tm.index > cursor) out.push({ type: 'text', value: seg.text.slice(cursor, tm.index) })
          out.push(entitySpan(type, name, name))
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
