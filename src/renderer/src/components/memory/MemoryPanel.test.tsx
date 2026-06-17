// @vitest-environment jsdom
// src/renderer/src/components/memory/MemoryPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RendererMemoryFact, RendererMemoryArtifact } from '../../../../preload/index.d'
import MemoryPanel from './MemoryPanel'

function fact(over: Partial<RendererMemoryFact> = {}): RendererMemoryFact {
  return {
    id: 'f1',
    body: 'Scourge is meta in WvW.',
    bodyNorm: 'scourge is meta in wvw.',
    entity: 'WvW',
    tags: [],
    pinned: false,
    userPinned: false,
    useCount: 0,
    score: 1,
    source: 'user',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastUsedAt: null,
    archived: false,
    ...over
  }
}

function artifact(over: Partial<RendererMemoryArtifact> = {}): RendererMemoryArtifact {
  return {
    id: 'a1',
    kind: 'playbook',
    title: 'WvW Strat',
    body: 'Use portal spam.',
    bodyNorm: 'use portal spam.',
    tags: [],
    entity: null,
    useCount: 0,
    score: 1,
    source: 'agent',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lastUsedAt: null,
    archived: false,
    ...over
  }
}

function makeOfficer(over: Record<string, unknown> = {}) {
  return {
    memoryList: vi.fn().mockResolvedValue({ facts: [fact()], artifacts: [artifact()] }),
    memoryCreate: vi.fn().mockResolvedValue({ id: 'f2', kind: 'fact', merged: false }),
    memoryUpdate: vi.fn().mockResolvedValue(undefined),
    memoryDelete: vi.fn().mockResolvedValue(undefined),
    memoryPin: vi.fn().mockResolvedValue(undefined),
    memoryReindex: vi.fn().mockResolvedValue(undefined),
    memoryIndexStats: vi.fn().mockResolvedValue({ total: 1, byKind: { fact: 1 }, lastIndexedAt: null }),
    onMemoryProgress: vi.fn().mockReturnValue(() => {}),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = makeOfficer()
})

describe('MemoryPanel', () => {
  it('renders the Memory panel heading', async () => {
    render(<MemoryPanel />)
    expect(await screen.findByText('Memory')).toBeTruthy()
  })

  it('shows facts loaded from memoryList', async () => {
    render(<MemoryPanel />)
    expect(await screen.findByText('Scourge is meta in WvW.')).toBeTruthy()
  })

  it('shows artifacts loaded from memoryList', async () => {
    render(<MemoryPanel />)
    expect(await screen.findByText('WvW Strat')).toBeTruthy()
  })

  it('filters facts by search text', async () => {
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({
        facts: [
          fact({ id: 'f1', body: 'Scourge is meta in WvW.' }),
          fact({ id: 'f2', body: 'Firebrand is support.' })
        ],
        artifacts: []
      })
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const search = screen.getByPlaceholderText(/search/i)
    fireEvent.change(search, { target: { value: 'Firebrand' } })
    await waitFor(() => expect(screen.queryByText('Scourge is meta in WvW.')).toBeNull())
    expect(screen.getByText('Firebrand is support.')).toBeTruthy()
  })

  it('calls memoryPin(id, true) when pin button clicked on fact with userPinned=false', async () => {
    const pin = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({
        facts: [fact({ id: 'f1', pinned: true, userPinned: false })],
        artifacts: []
      }),
      memoryPin: pin
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const pinBtn = screen.getByRole('button', { name: /^pin$/i })
    fireEvent.click(pinBtn)
    await waitFor(() => expect(pin).toHaveBeenCalledWith('f1', true))
  })

  it('calls memoryPin(id, false) when unpin button clicked on fact with userPinned=true', async () => {
    const pin = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({
        facts: [fact({ id: 'f1', pinned: true, userPinned: true })],
        artifacts: []
      }),
      memoryPin: pin
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const unpinBtn = screen.getByRole('button', { name: /^unpin$/i })
    fireEvent.click(unpinBtn)
    await waitFor(() => expect(pin).toHaveBeenCalledWith('f1', false))
  })

  it('calls memoryDelete with "fact" when delete button is clicked on a fact', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({ facts: [fact()], artifacts: [] }),
      memoryDelete: del
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const delBtn = screen.getByRole('button', { name: /^delete$/i })
    fireEvent.click(delBtn)
    await waitFor(() => expect(del).toHaveBeenCalledWith('fact', 'f1'))
  })

  it('calls memoryUpdate to archive a fact', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({ facts: [fact()], artifacts: [] }),
      memoryUpdate: update
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const archBtn = screen.getByRole('button', { name: /^archive$/i })
    fireEvent.click(archBtn)
    await waitFor(() => expect(update).toHaveBeenCalledWith('fact', 'f1', { archived: true }))
  })

  it('calls memoryDelete("artifact", id) when artifact delete button is clicked', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({ facts: [], artifacts: [artifact()] }),
      memoryDelete: del
    })
    render(<MemoryPanel />)
    await screen.findByText('WvW Strat')
    const delBtn = screen.getByRole('button', { name: /delete artifact/i })
    fireEvent.click(delBtn)
    await waitFor(() => expect(del).toHaveBeenCalledWith('artifact', 'a1'))
  })

  it('calls memoryUpdate("artifact", id, { archived: true }) when artifact archive button is clicked', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({ facts: [], artifacts: [artifact()] }),
      memoryUpdate: update
    })
    render(<MemoryPanel />)
    await screen.findByText('WvW Strat')
    const archBtn = screen.getByRole('button', { name: /^archive$/i })
    fireEvent.click(archBtn)
    await waitFor(() => expect(update).toHaveBeenCalledWith('artifact', 'a1', { archived: true }))
  })

  it('creates a fact via the Add fact form', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'f3', kind: 'fact', merged: false })
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({ facts: [fact()], artifacts: [] }),
      memoryCreate: create
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const textarea = screen.getByPlaceholderText(/new fact/i)
    fireEvent.change(textarea, { target: { value: 'New fact text' } })
    fireEvent.click(screen.getByRole('button', { name: /add fact/i }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'fact', body: 'New fact text' })
      )
    )
  })

  it('includes entity in memoryCreate when entity input is filled', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'f4', kind: 'fact', merged: false })
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({ facts: [fact()], artifacts: [] }),
      memoryCreate: create
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const textarea = screen.getByPlaceholderText(/new fact/i)
    fireEvent.change(textarea, { target: { value: 'Zara is a WvW roamer' } })
    const entityInput = screen.getByPlaceholderText(/about/i)
    fireEvent.change(entityInput, { target: { value: 'Zara' } })
    fireEvent.click(screen.getByRole('button', { name: /add fact/i }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'fact', body: 'Zara is a WvW roamer', entity: 'Zara' })
      )
    )
  })

  it('calls memoryReindex when Rebuild index button is clicked', async () => {
    const reindex = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({ memoryReindex: reindex })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }))
    await waitFor(() => expect(reindex).toHaveBeenCalled())
  })

  it('re-fetches on onMemoryProgress event', async () => {
    let progressCb: ((e: unknown) => void) | null = null
    const list = vi.fn().mockResolvedValue({ facts: [fact()], artifacts: [] })
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: list,
      onMemoryProgress: vi.fn().mockImplementation((cb: (e: unknown) => void) => {
        progressCb = cb
        return () => {}
      })
    })
    render(<MemoryPanel />)
    await screen.findByText('Scourge is meta in WvW.')
    const callsBefore = list.mock.calls.length
    if (progressCb) progressCb({ type: 'changed' })
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('unsubscribes onMemoryProgress on unmount', () => {
    const unsub = vi.fn()
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      onMemoryProgress: vi.fn().mockReturnValue(unsub)
    })
    const { unmount } = render(<MemoryPanel />)
    unmount()
    expect(unsub).toHaveBeenCalled()
  })

  it('shows archived facts when show-archived filter is enabled', async () => {
    ;(window as unknown as { officer: unknown }).officer = makeOfficer({
      memoryList: vi.fn().mockResolvedValue({
        facts: [fact({ id: 'fa', body: 'Archived fact', archived: true })],
        artifacts: []
      })
    })
    render(<MemoryPanel />)
    // By default archived are hidden. Check that the archived toggle shows them.
    const archToggle = screen.getByRole('button', { name: /show archived/i })
    fireEvent.click(archToggle)
    expect(await screen.findByText('Archived fact')).toBeTruthy()
  })
})
