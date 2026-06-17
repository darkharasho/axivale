// @vitest-environment jsdom
// src/renderer/src/components/meta/Meta.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import Meta from './Meta'
import { META_OVERVIEW, WIKI_REF } from './MetaNav'

function mode(over: Partial<RendererMetaMode> = {}): RendererMetaMode {
  return {
    id: '1',
    mode: 'WvW',
    notes: 'Scourge + Firebrand core.',
    refreshedAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '',
    sources: [
      { label: 'MetaBattle', url: 'https://metabattle.com', status: 'ok', fetchedAt: '2026-06-10T00:00:00.000Z', error: null, group: 'meta' },
      { label: 'Hardstuck', url: 'https://hardstuck.gg', status: 'error', fetchedAt: null, error: 'timeout', group: 'meta' }
    ],
    playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false },
    ...over
  }
}

const noop = (): void => {}

beforeEach(() => {
  // Meta renders DEV-only bits (force-refresh, MetaIndexInspector) that touch officer;
  // a stub keeps any incidental access from throwing. DEV is false under vitest, so
  // these don't render, but the stub is cheap insurance.
  ;(window as unknown as { officer: unknown }).officer = {
    metaForceRefresh: vi.fn(),
    metaIndexStats: vi.fn().mockResolvedValue({ total: 0, byMode: {}, bySource: {}, lastIndexedAt: null }),
    metaIndexSample: vi.fn().mockResolvedValue([]),
    metaIndexSearch: vi.fn().mockResolvedValue([]),
    wikiIndexStats: vi
      .fn()
      .mockResolvedValue({ total: 42, byMode: { legendaries: 12, skills: 30 }, bySource: {}, lastIndexedAt: null })
  }
})

describe('Meta pane', () => {
  it('shows the overview intro when Overview is active', () => {
    render(<Meta modes={[mode()]} active={META_OVERVIEW} busy={{}} fetching={{}} onRefresh={noop} />)
    expect(screen.getByText('Sources')).toBeTruthy()
    expect(screen.getByText(/the knowledge AxiVale draws on for recall/i)).toBeTruthy()
  })

  it('renders the Wiki reference panel with its coverage note', async () => {
    render(<Meta modes={[mode()]} active={WIKI_REF} busy={{}} fetching={{}} onRefresh={noop} />)
    expect(screen.getByText('Wiki')).toBeTruthy()
    expect(screen.getByText(/falls back to a live wiki lookup/i)).toBeTruthy()
    expect(await screen.findByText(/legendaries · 12/)).toBeTruthy()
  })

  it('renders the selected mode with its summary and sources', () => {
    render(<Meta modes={[mode()]} active="1" busy={{}} fetching={{}} onRefresh={noop} />)
    expect(screen.getByText('Scourge + Firebrand core.')).toBeTruthy()
    expect(screen.getByText('MetaBattle')).toBeTruthy()
    expect(screen.getByText('Hardstuck')).toBeTruthy()
  })

  it('shows the comp playbook launcher only for WvW', () => {
    const { rerender } = render(
      <Meta modes={[mode({ id: '1', mode: 'WvW' })]} active="1" busy={{}} fetching={{}} onRefresh={noop} />
    )
    expect(screen.queryByRole('button', { name: 'Comp playbook' })).toBeTruthy()

    rerender(
      <Meta modes={[mode({ id: '2', mode: 'Roaming' })]} active="2" busy={{}} fetching={{}} onRefresh={noop} />
    )
    expect(screen.queryByRole('button', { name: 'Comp playbook' })).toBeNull()
  })

  it('shows a refreshing indicator when the active mode is busy', () => {
    render(<Meta modes={[mode()]} active="1" busy={{ '1': true }} fetching={{}} onRefresh={noop} />)
    expect(screen.getByText(/refreshing/i)).toBeTruthy()
  })

  it('falls back to a prompt when the active id matches no mode', () => {
    render(<Meta modes={[mode()]} active="nope" busy={{}} fetching={{}} onRefresh={noop} />)
    expect(screen.getByText('Select a mode.')).toBeTruthy()
  })
})
