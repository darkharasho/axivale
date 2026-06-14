// @vitest-environment jsdom
// src/renderer/src/components/panels/Meta.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import Meta from './Meta'

function officer() {
  let progressCb: ((e: unknown) => void) | null = null
  return {
    metaForceRefresh: vi.fn().mockResolvedValue(undefined),
    metaIndexStats: vi.fn().mockResolvedValue({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
    metaIndexSample: vi.fn().mockResolvedValue([]),
    metaIndexSearch: vi.fn().mockResolvedValue([]),
    metaList: () =>
      Promise.resolve([
        {
          id: '1',
          mode: 'WvW',
          notes: 'Scourge + Firebrand core.',
          refreshedAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '',
          sources: [
            { label: 'MetaBattle', url: 'https://metabattle.com', status: 'ok', fetchedAt: '2026-06-10T00:00:00.000Z', error: null },
            { label: 'Hardstuck', url: 'https://hardstuck.gg', status: 'error', fetchedAt: null, error: 'timeout' },
            { label: 'gw2mists', url: 'https://gw2mists.com', status: 'never', fetchedAt: null, error: null }
          ]
        }
      ]),
    onMetaProgress: (cb: (e: unknown) => void) => {
      progressCb = cb
      return () => {}
    },
    __fire: (e: unknown) => progressCb?.(e)
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Meta panel (read-only)', () => {
  it('renders the distilled summary and source chips', async () => {
    render(<Meta />)
    expect(await screen.findByText('WvW')).toBeTruthy()
    expect(screen.getByText('Scourge + Firebrand core.')).toBeTruthy()
    expect(screen.getByText('MetaBattle')).toBeTruthy()
    expect(screen.getByText('ok')).toBeTruthy()
    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByText('never')).toBeTruthy()
  })

  it('has no editor — no textbox and no save button', async () => {
    render(<Meta />)
    await screen.findByText('WvW')
    // The only textbox is the dev-gated index inspector's test-search box, not a notes editor.
    const textboxes = screen.queryAllByRole('textbox')
    expect(textboxes.every((t) => t.getAttribute('placeholder') === 'test search…')).toBe(true)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('shows a refreshing indicator while a mode is in progress', async () => {
    const o = officer()
    ;(window as unknown as { officer: unknown }).officer = o
    render(<Meta />)
    await screen.findByText('WvW')
    act(() => {
      ;(o as unknown as { __fire: (e: unknown) => void }).__fire({ type: 'mode-start', modeId: '1' })
    })
    expect(screen.getByText(/refreshing/i)).toBeTruthy()
  })

  it('dev force-recrawl button triggers metaForceRefresh', async () => {
    const force = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = { ...officer(), metaForceRefresh: force }
    render(<Meta />)
    await screen.findByText('WvW')
    const btn = screen.queryByRole('button', { name: /force re-crawl/i })
    // import.meta.env.DEV is true under vitest, so the button should render
    if (btn) {
      fireEvent.click(btn)
      expect(force).toHaveBeenCalled()
    } else {
      throw new Error('dev button not rendered — check import.meta.env.DEV in test env')
    }
  })
})
