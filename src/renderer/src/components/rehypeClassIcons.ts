import { visit, SKIP } from 'unist-util-visit'
import type { Root, Text, ElementContent, Element } from 'hast'
import { PROFESSIONS } from './panels/classes'

// All recognized profession + elite-spec names, longest first so e.g.
// "Dragonhunter" wins before any shorter overlap.
const CLASS_NAMES = Object.entries(PROFESSIONS)
  .flatMap(([prof, specs]) => [prof, ...specs])
  .sort((a, b) => b.length - a.length)

const PATTERN = `\\b(${CLASS_NAMES.join('|')})\\b`

/** Fresh regex per use — exec() with /g/ carries state via lastIndex. */
export function makeClassRegex(): RegExp {
  return new RegExp(PATTERN, 'gi')
}

// Don't rewrite class names inside code/links — they're literals or anchors there.
const SKIP_PARENTS = new Set(['code', 'pre', 'a'])

/**
 * Rehype plugin: wrap recognized GW2 class/elite-spec names in marker spans
 * (<span class="axi-classicon" data-class="Dragonhunter">Dragonhunter</span>).
 * The markdown `span` override (renderRichSpan) prepends the inline icon.
 */
export function rehypeClassIcons() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return
      if (parent.type === 'element' && SKIP_PARENTS.has((parent as Element).tagName)) return
      const text = node.value
      const regex = makeClassRegex()
      if (!regex.test(text)) return
      regex.lastIndex = 0

      const out: ElementContent[] = []
      let last = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        const name = m[0]
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
        out.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['axi-classicon'], 'data-class': name },
          children: [{ type: 'text', value: name }]
        })
        last = m.index + name.length
      }
      if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
