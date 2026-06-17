// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { RendererMetaMode } from '../../../../preload/index.d'
import MetaNav, { WIKI_REF } from './MetaNav'

function mode(id: string, name: string): RendererMetaMode {
  return {
    id,
    mode: name,
    notes: '',
    refreshedAt: null,
    updatedAt: '',
    sources: [],
    playbook: { derived: null, derivedAt: null, principles: '', overrides: '', blessed: false }
  }
}

const modes = [mode('1', 'PvE'), mode('2', 'WvW'), mode('3', 'Guides')]

describe('MetaNav grouping', () => {
  it('splits the rail into Meta / Wiki / Guides section headers', () => {
    render(<MetaNav modes={modes} busy={{}} active="" onSelect={vi.fn()} />)
    const headers = screen.getAllByText(/^(Meta|Wiki|Guides)$/).map((n) => n.textContent)
    expect(headers).toContain('Meta')
    expect(headers).toContain('Wiki')
    expect(headers).toContain('Guides')
  })

  it('puts build modes under Meta and the Guides mode under Guides', () => {
    render(<MetaNav modes={modes} busy={{}} active="" onSelect={vi.fn()} />)
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('PvE')).toBeTruthy()
    // "Guides" appears twice: once as the section header, once as the mode button
    expect(screen.getAllByText('Guides').length).toBeGreaterThanOrEqual(2)
  })

  it('always offers the Wiki reference entry even with no guide modes', () => {
    const onSelect = vi.fn()
    render(<MetaNav modes={[mode('1', 'PvE')]} busy={{}} active="" onSelect={onSelect} />)
    const wiki = screen.getByText('Reference corpus')
    within(wiki.closest('button')!).getByText('Reference corpus').click()
    expect(onSelect).toHaveBeenCalledWith(WIKI_REF)
    expect(screen.getByText('No guide sources.')).toBeTruthy()
  })
})
