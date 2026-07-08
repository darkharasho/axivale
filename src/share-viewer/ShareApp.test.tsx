// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import ShareApp from './ShareApp'
import type { ShareDoc } from './shareTypes'

function shareDoc(): ShareDoc {
  return {
    v: 1,
    id: 'testshare',
    kind: 'response',
    title: 'Test dispatch',
    createdAt: '2026-07-06T18:00:00.000Z',
    app: { name: 'AxiVale', version: '1.3.2' },
    turns: [
      {
        agentText: 'Big headline\n\nIntro paragraph.\n\n{{figure}}\n\nClosing paragraph.',
        filedAt: '1:43 PM',
        tools: [
          {
            name: 'axibridge_query',
            display: {
              kind: 'table',
              data: {
                title: 'TABLE_TITLE',
                columns: [{ key: 'a', label: 'A' }],
                rows: [{ a: 1 }]
              }
            }
          },
          {
            name: 'axibridge_render_chart',
            display: {
              kind: 'chart',
              data: {
                type: 'bar',
                title: 'CHART_TITLE',
                xKey: 'x',
                series: [{ key: 'y', label: 'Y' }],
                rows: [{ x: 'one', y: 1 }]
              }
            }
          }
        ]
      }
    ]
  }
}

describe('ShareApp figure placement', () => {
  beforeEach(() => {
    window.location.hash = '#/s/testshare'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => shareDoc() })
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('maps {{figure}} markers to the same figure list as the app (tables excluded)', async () => {
    const { findByText, container } = render(<ShareApp />)
    await findByText('Intro paragraph.')
    const figures = [...container.querySelectorAll('figure.post-figure')]
    expect(figures.length).toBe(2)
    // The marker slot gets the chart — exactly what the app renders inline.
    expect(figures[0].textContent).toContain('CHART_TITLE')
    // The table (Actions-rail material in the app) still renders, appended after.
    expect(figures[1].textContent).toContain('TABLE_TITLE')
  })

  it('keeps the marker figure between its surrounding paragraphs', async () => {
    const { findByText, container } = render(<ShareApp />)
    const intro = await findByText('Intro paragraph.')
    const closing = await findByText('Closing paragraph.')
    const chartFigure = [...container.querySelectorAll('figure.post-figure')].find((f) =>
      f.textContent?.includes('CHART_TITLE')
    )
    expect(chartFigure).toBeTruthy()
    expect(
      intro.compareDocumentPosition(chartFigure!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      chartFigure!.compareDocumentPosition(closing) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
