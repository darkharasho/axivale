import { visit, SKIP } from 'unist-util-visit'
import type { Root, Text, ElementContent } from 'hast'
import { makeEmojiRegex } from './emojiIcons'

/**
 * Rehype plugin: replace emoji in text nodes with marker spans
 * (<span class="axi-emoji" data-emoji="🔥">). The markdown `span`
 * component override (renderEmojiSpan) turns them into icons.
 */
export function rehypeEmojiIcons() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return
      const text = node.value
      const regex = makeEmojiRegex()
      if (!regex.test(text)) return
      regex.lastIndex = 0

      const out: ElementContent[] = []
      let last = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        const emoji = m[0]
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
        out.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['axi-emoji'], 'data-emoji': emoji },
          children: []
        })
        last = m.index + emoji.length
      }
      if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
