// @vitest-environment jsdom
// src/renderer/src/components/panels/Skills.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import Skills from './Skills'
import SkillsNav from './SkillsNav'
import { useSkills } from './useSkills'

// Harness mounting both the rail + detail over one controller, as App does.
function Harness(): ReactElement {
  const ctl = useSkills()
  return (
    <div>
      <SkillsNav ctl={ctl} />
      <Skills ctl={ctl} />
    </div>
  )
}

function officer(over: Record<string, unknown> = {}) {
  return {
    skillsList: vi.fn().mockResolvedValue([
      { id: '1', name: 'Raid Recap', whenToUse: 'how raid went', instructions: 'do x', enabled: true, createdAt: '', updatedAt: '' }
    ]),
    skillsCreate: vi.fn().mockResolvedValue({ id: '2', name: 'Roster Check', whenToUse: 'roster', instructions: 'list inactive', enabled: true, createdAt: '', updatedAt: '' }),
    skillsUpdate: vi.fn().mockResolvedValue(null),
    skillsDelete: vi.fn().mockResolvedValue(undefined),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Skills panel', () => {
  it('lists existing skills in the rail and opens the first one', async () => {
    render(<Harness />)
    expect(await screen.findByText('Raid Recap')).toBeTruthy()
    await waitFor(() => expect((screen.getByPlaceholderText(/skill name/i) as HTMLInputElement).value).toBe('Raid Recap'))
  })

  it('creates a skill from the New flow', async () => {
    const create = vi.fn().mockResolvedValue({ id: '2', name: 'Roster Check', whenToUse: 'roster', instructions: 'list inactive', enabled: true, createdAt: '', updatedAt: '' })
    ;(window as unknown as { officer: unknown }).officer = officer({ skillsCreate: create })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: /\+ new/i }))
    fireEvent.change(screen.getByPlaceholderText(/skill name/i), { target: { value: 'Roster Check' } })
    fireEvent.change(screen.getByPlaceholderText(/when to use/i), { target: { value: 'roster' } })
    fireEvent.change(screen.getByPlaceholderText(/instructions/i), { target: { value: 'list inactive' } })
    fireEvent.click(screen.getByRole('button', { name: /add skill/i }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Roster Check', whenToUse: 'roster', instructions: 'list inactive' })
    )
  })

  it('saves edits to the selected skill', async () => {
    const update = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { officer: unknown }).officer = officer({ skillsUpdate: update })
    render(<Harness />)
    const name = (await screen.findByPlaceholderText(/skill name/i)) as HTMLInputElement
    await waitFor(() => expect(name.value).toBe('Raid Recap'))
    fireEvent.change(name, { target: { value: 'Raid Recap v2' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('1', { name: 'Raid Recap v2', whenToUse: 'how raid went', instructions: 'do x' })
    )
  })

  it('renders a markdown preview of the instructions', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      skillsList: vi.fn().mockResolvedValue([
        { id: '1', name: 'Raid Recap', whenToUse: 'how raid went', instructions: '# Heading\n\n- bullet', enabled: true, createdAt: '', updatedAt: '' }
      ])
    })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: /^preview$/i }))
    expect(await screen.findByRole('heading', { name: 'Heading' })).toBeTruthy()
  })
})
