// @vitest-environment jsdom
// src/renderer/src/components/panels/Meta.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import Meta from './Meta'

function mode(over: Record<string, unknown> = {}) {
  return {
    id: '1',
    mode: 'WvW',
    notes: 'Scourge + Firebrand core.',
    refreshedAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '',
    sources: [
      { label: 'MetaBattle', url: 'https://metabattle.com', status: 'ok', fetchedAt: '2026-06-10T00:00:00.000Z', error: null }
    ],
    playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false },
    ...over
  }
}

function officerWith(modes: Array<Record<string, unknown>>) {
  return {
    metaForceRefresh: vi.fn().mockResolvedValue(undefined),
    metaIndexStats: vi.fn().mockResolvedValue({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
    metaIndexSample: vi.fn().mockResolvedValue([]),
    metaIndexSearch: vi.fn().mockResolvedValue([]),
    metaUpdatePlaybook: vi.fn().mockResolvedValue(null),
    metaDeriveComp: vi.fn().mockResolvedValue({ ok: true }),
    metaList: () => Promise.resolve(modes),
    onMetaProgress: () => () => {}
  }
}

function officer() {
  let progressCb: ((e: unknown) => void) | null = null
  return {
    metaForceRefresh: vi.fn().mockResolvedValue(undefined),
    metaIndexStats: vi.fn().mockResolvedValue({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
    metaIndexSample: vi.fn().mockResolvedValue([]),
    metaIndexSearch: vi.fn().mockResolvedValue([]),
    metaUpdatePlaybook: vi.fn().mockResolvedValue(null),
    metaDeriveComp: vi.fn().mockResolvedValue({ ok: true }),
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
          ],
          playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false }
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

  it('has no save button (playbook saves on blur, not a save button)', async () => {
    render(<Meta />)
    await screen.findByText('WvW')
    // PlaybookSection adds principles + overrides textareas; no discrete save button.
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

  it('shows a Comp playbook trigger for WvW, positioned after the sources', async () => {
    ;(window as unknown as { officer: unknown }).officer = officerWith([mode()])
    const { container } = render(<Meta />)
    await screen.findByText('WvW')
    const trigger = screen.getByRole('button', { name: /comp playbook/i })
    const sources = container.querySelector('.meta-sources')!
    // trigger comes AFTER the sources list in document order
    expect(sources.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the playbook fields hidden until the trigger is clicked, then shows them in a popup', async () => {
    ;(window as unknown as { officer: unknown }).officer = officerWith([mode()])
    render(<Meta />)
    await screen.findByText('WvW')
    // closed: no playbook fields in the DOM
    expect(screen.queryByText('Principles')).toBeNull()
    expect(screen.queryByText('Guild overrides')).toBeNull()
    expect(screen.queryByRole('button', { name: /refresh from axibridge/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /comp playbook/i }))
    // open: fields visible
    expect(screen.getByText('Principles')).toBeTruthy()
    expect(screen.getByText('Guild overrides')).toBeTruthy()
    expect(screen.getByRole('button', { name: /refresh from axibridge/i })).toBeTruthy()
  })

  it('does NOT render a Comp playbook trigger for non-WvW modes (Roaming, PvE)', async () => {
    ;(window as unknown as { officer: unknown }).officer = officerWith([
      mode({ id: 'r', mode: 'WvW Roaming' }),
      mode({ id: 'p', mode: 'PvE' })
    ])
    render(<Meta />)
    await screen.findByText('WvW Roaming')
    expect(screen.queryByRole('button', { name: /comp playbook/i })).toBeNull()
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
