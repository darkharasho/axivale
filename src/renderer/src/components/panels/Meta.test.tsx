// @vitest-environment jsdom
// src/renderer/src/components/panels/Meta.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Meta from './Meta'

function officer(over: Record<string, unknown> = {}) {
  return {
    metaList: vi.fn().mockResolvedValue([
      { id: '1', mode: 'WvW', sources: [{ label: 'MetaBattle', url: 'https://metabattle.com' }], notes: 'scourge', updatedAt: '' }
    ]),
    metaAddMode: vi.fn().mockResolvedValue({ id: '2', mode: 'PvE', sources: [], notes: '', updatedAt: '' }),
    metaUpdateMode: vi.fn().mockResolvedValue(null),
    metaRemoveMode: vi.fn().mockResolvedValue(undefined),
    ...over
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Meta panel', () => {
  it('lists modes with their notes', async () => {
    render(<Meta />)
    expect(await screen.findByText('WvW')).toBeTruthy()
    expect(screen.getByDisplayValue('scourge')).toBeTruthy()
  })

  it('saves edited notes', async () => {
    const update = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { officer: unknown }).officer = officer({ metaUpdateMode: update })
    render(<Meta />)
    const ta = (await screen.findByDisplayValue('scourge')) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'spellbreaker meta' } })
    fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0])
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('1', expect.objectContaining({ notes: 'spellbreaker meta' }))
    )
  })
})
