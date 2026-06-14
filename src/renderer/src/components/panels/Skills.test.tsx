// @vitest-environment jsdom
// src/renderer/src/components/panels/Skills.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Skills from './Skills'

function officer(over: Record<string, unknown> = {}) {
  return {
    skillsList: vi.fn().mockResolvedValue([
      { id: '1', name: 'Raid Recap', whenToUse: 'how raid went', instructions: 'do x', enabled: true, createdAt: '', updatedAt: '' }
    ]),
    skillsCreate: vi.fn().mockResolvedValue({ id: '2', name: 'New', whenToUse: 'w', instructions: 'i', enabled: true, createdAt: '', updatedAt: '' }),
    skillsUpdate: vi.fn().mockResolvedValue(null),
    skillsDelete: vi.fn().mockResolvedValue(undefined),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Skills panel', () => {
  it('lists existing skills', async () => {
    render(<Skills />)
    expect(await screen.findByText('Raid Recap')).toBeTruthy()
  })

  it('creates a skill from the form', async () => {
    const create = vi.fn().mockResolvedValue({ id: '2', name: 'New', whenToUse: 'w', instructions: 'i', enabled: true, createdAt: '', updatedAt: '' })
    ;(window as unknown as { officer: unknown }).officer = officer({ skillsCreate: create })
    render(<Skills />)
    fireEvent.change(await screen.findByPlaceholderText(/name/i), { target: { value: 'Roster Check' } })
    fireEvent.change(screen.getByPlaceholderText(/when to use/i), { target: { value: 'roster' } })
    fireEvent.change(screen.getByPlaceholderText(/instructions/i), { target: { value: 'list inactive' } })
    fireEvent.click(screen.getByRole('button', { name: /add skill/i }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Roster Check', whenToUse: 'roster', instructions: 'list inactive' })
    )
  })
})
