// @vitest-environment jsdom
import { render } from '@testing-library/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, it, expect } from 'vitest'
import { rehypeEmojiIcons } from './rehypeEmojiIcons'
import { rehypeClassIcons } from './rehypeClassIcons'
import { renderRichSpan } from './richSpan'

function md(src: string) {
  return render(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeEmojiIcons, rehypeClassIcons]}
      components={{ span: renderRichSpan }}
    >
      {src}
    </ReactMarkdown>
  )
}

describe('class-icon prose pipeline', () => {
  it('renders an inline svg for a recognized class name', () => {
    const { container } = md('The Reaper and the Dragonhunter held the line.')
    expect(container.querySelectorAll('.axi-class').length).toBe(2)
    expect(container.querySelectorAll('svg').length).toBe(2)
    expect(container.textContent).toContain('Reaper')
    expect(container.textContent).toContain('Dragonhunter')
  })

  it('leaves unrecognized words untouched', () => {
    const { container } = md('The barbarian fled.')
    expect(container.querySelectorAll('.axi-class').length).toBe(0)
  })
})
