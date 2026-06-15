// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Turn } from '../state'

// Stub ClipboardItem (not available in jsdom)
if (typeof ClipboardItem === 'undefined') {
  // @ts-expect-error — jsdom doesn't implement ClipboardItem
  global.ClipboardItem = class ClipboardItem {
    private _items: Record<string, Blob>
    constructor(items: Record<string, Blob>) {
      this._items = items
    }
    getType(type: string): Blob {
      return this._items[type]
    }
  }
}

// Mock modern-screenshot at the module boundary
vi.mock('modern-screenshot', () => ({
  domToBlob: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
}))

// Import after mocks — must be a top-level await because vitest hoists vi.mock
const { default: Article } = await import('./Article')
const { domToBlob } = await import('modern-screenshot')
const domToBlobMock = domToBlob as ReturnType<typeof vi.fn>

function doneTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 1,
    userText: 'What is the guild roster?',
    agentText: 'The roster has five members. They are all veterans.',
    tools: [],
    done: true,
    error: null,
    filedAt: '9:42 pm',
    ...overrides
  }
}

function streamingTurn(): Turn {
  return {
    id: 2,
    userText: 'Tell me more',
    agentText: 'More details coming in',
    tools: [],
    done: false,
    error: null,
    filedAt: '9:43 pm'
  }
}

describe('Article copy-as-image button', () => {
  let clipboardWriteMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clipboardWriteMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: clipboardWriteMock },
      writable: true,
      configurable: true
    })
    domToBlobMock.mockClear()
    domToBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows copy button when turn is done', () => {
    render(<Article turn={doneTurn()} conversationId={null} />)
    const btn = screen.getByRole('button', { name: /copy article as image/i })
    expect(btn).toBeTruthy()
  })

  it('does NOT show copy button while turn is streaming', () => {
    render(<Article turn={streamingTurn()} conversationId={null} />)
    const btn = screen.queryByRole('button', { name: /copy article as image/i })
    expect(btn).toBeNull()
  })

  it('does NOT show copy button during thinking state (no text yet)', () => {
    const thinking = doneTurn({ agentText: '', done: false })
    render(<Article turn={thinking} conversationId={null} />)
    const btn = screen.queryByRole('button', { name: /copy article as image/i })
    expect(btn).toBeNull()
  })

  it('calls domToBlob and clipboard.write on click', async () => {
    render(<Article turn={doneTurn()} conversationId={null} />)
    const btn = screen.getByRole('button', { name: /copy article as image/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(domToBlobMock).toHaveBeenCalledTimes(1)
      expect(clipboardWriteMock).toHaveBeenCalledTimes(1)
    })
  })

  it('clipboard.write receives a ClipboardItem array', async () => {
    render(<Article turn={doneTurn()} conversationId={null} />)
    const btn = screen.getByRole('button', { name: /copy article as image/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledTimes(1)
    })
    const items: unknown[] = clipboardWriteMock.mock.calls[0][0]
    expect(Array.isArray(items)).toBe(true)
    expect(items).toHaveLength(1)
    expect(items[0]).toBeInstanceOf(ClipboardItem)
  })

  it('handles clipboard failure gracefully without throwing', async () => {
    clipboardWriteMock.mockRejectedValueOnce(new Error('Permission denied'))
    render(<Article turn={doneTurn()} conversationId={null} />)
    const btn = screen.getByRole('button', { name: /copy article as image/i })
    expect(() => {
      fireEvent.click(btn)
    }).not.toThrow()
    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledTimes(1)
    })
  })

  it('domToBlob is called with the article node and correct options', async () => {
    render(<Article turn={doneTurn()} conversationId={null} />)
    const btn = screen.getByRole('button', { name: /copy article as image/i })
    fireEvent.click(btn)
    await waitFor(() => expect(domToBlobMock).toHaveBeenCalledTimes(1))
    const [capturedNode, options] = domToBlobMock.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    // Capture target is an HTMLElement
    expect(capturedNode).toBeInstanceOf(HTMLElement)
    // Options specify PNG type and 2x scale
    expect(options).toMatchObject({ type: 'image/png', scale: 2 })
    // A filter function is provided to exclude the button
    expect(typeof options.filter).toBe('function')
    const filterFn = options.filter as (el: Node) => boolean
    // The filter should block the copy button
    const fakeBtn = document.createElement('button')
    fakeBtn.dataset.copyBtn = '1'
    expect(filterFn(fakeBtn)).toBe(false)
    // The filter should pass other elements
    const fakeDiv = document.createElement('div')
    expect(filterFn(fakeDiv)).toBe(true)
  })
})

describe('Article inline figures', () => {
  const chartTool = {
    id: 't1',
    name: 'axibridge_render_chart',
    input: {},
    resultText: '{}',
    display: {
      kind: 'chart' as const,
      data: {
        type: 'bar' as const,
        title: 'Kills',
        xKey: 'day',
        series: [{ key: 'k', label: 'Kills' }],
        rows: [{ day: 'Mon', k: 4 }]
      }
    }
  }
  // Tool DATA tables are not inlined — they live in the Actions rail.
  const tableTool = {
    id: 't2',
    name: 'axibridge_run_summary',
    input: {},
    resultText: '{}',
    display: {
      kind: 'table' as const,
      data: { title: 'Run Summary', columns: [{ key: 'a', label: 'Wins' }], rows: [{ a: 15 }] }
    }
  }

  it('renders a chart figure at the {{figure}} marker position', () => {
    const { container } = render(
      <Article
        turn={doneTurn({
          agentText: 'Headline\n\nBefore the chart.\n\n{{figure}}\n\nAfter the chart.',
          tools: [chartTool]
        })}
        conversationId={null}
      />
    )
    expect(container.querySelector('.post-figure .richchart')).toBeTruthy()
    expect(screen.getByText('Before the chart.')).toBeTruthy()
    expect(screen.getByText('After the chart.')).toBeTruthy()
  })

  it('does NOT render a chart figure inline when there is no {{figure}} marker', () => {
    const { container } = render(
      <Article turn={doneTurn({ agentText: 'Headline\n\nNo marker here.', tools: [chartTool] })} conversationId={null} />
    )
    expect(container.querySelector('.post-figure')).toBeNull()
    expect(container.querySelector('.richchart')).toBeNull()
  })

  it('does NOT inline a tool data table (it belongs in the Actions rail)', () => {
    const { container } = render(
      <Article turn={doneTurn({ agentText: 'Headline\n\n{{figure}}', tools: [tableTool] })} conversationId={null} />
    )
    expect(container.querySelector('.richtable')).toBeNull()
    expect(screen.queryByText('Wins')).toBeNull()
  })

  it('does not render a figure for an errored tool', () => {
    const { container } = render(
      <Article
        turn={doneTurn({
          agentText: 'Headline\n\n{{figure}}',
          tools: [{ ...chartTool, isError: true }]
        })}
        conversationId={null}
      />
    )
    expect(container.querySelector('.richchart')).toBeNull()
  })
})

describe('Article headline (lede)', () => {
  it('renders a markdown link in the headline as an anchor, not literal syntax', () => {
    const { container } = render(
      <Article
        turn={doneTurn({
          agentText:
            "Here's the build from [MetaBattle](https://metabattle.com/wiki/Build:X) for raids.\n\nBody paragraph."
        })}
        conversationId={null}
      />
    )
    const link = container.querySelector('.lede a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('https://metabattle.com/wiki/Build:X')
    expect(link?.textContent).toBe('MetaBattle')
    // The raw markdown link syntax must not leak into the rendered headline.
    expect(container.querySelector('.lede')?.textContent).not.toContain('](')
  })
})
