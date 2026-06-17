// @vitest-environment jsdom
// src/renderer/src/components/memory/MemoryRollup.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MemoryRollup from './MemoryRollup'

beforeEach(() => {
  ;(globalThis as unknown as { window: { officer: unknown } }).window.officer = {
    memoryFactsForEntity: vi.fn().mockResolvedValue([
      { id: 'f1', body: 'Prefers WvW small-scale', entity: '111', tags: [], pinned: false, userPinned: false,
        useCount: 0, score: 0, source: 'agent', createdAt: new Date().toISOString(), lastUsedAt: null, archived: false, bodyNorm: '' }
    ])
  }
})

describe('MemoryRollup', () => {
  it('renders the entity facts under a heading', async () => {
    render(<MemoryRollup entity="111" />)
    await waitFor(() => expect(screen.getByText(/Prefers WvW small-scale/)).toBeTruthy())
    expect(screen.getByText(/What AxiVale knows/i)).toBeTruthy()
  })

  it('renders nothing when there are no facts', async () => {
    ;(window.officer.memoryFactsForEntity as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    const { container } = render(<MemoryRollup entity="999" />)
    await waitFor(() => expect(container.querySelector('.mem-rollup')).toBeNull())
  })
})
