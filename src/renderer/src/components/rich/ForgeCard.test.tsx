// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import ForgeCard from './ForgeCard'

const build = {
  id: 'b1',
  title: 'Quickness Firebrand',
  profession: 'Guardian',
  gameMode: 'wvw',
  specializations: [{ name: 'Firebrand', elite: true }],
  equipment: { weapons: { mainhand1: 'axe', offhand1: 'shield' }, statPackage: 'Celestial' }
}

beforeEach(() => {
  ;(window as unknown as { officer: Record<string, unknown> }).officer = {
    forgeCatalogUpgrades: vi.fn().mockResolvedValue({ runes: [], relics: [] })
  }
})

describe('ForgeCard', () => {
  it('renders a scoped mini build card for build-card payloads', async () => {
    const { container } = render(
      <ForgeCard display={{ kind: 'build-card', data: { build } }} />
    )
    await waitFor(() => expect(container.querySelector('.mini-card')).toBeTruthy())
    expect(container.querySelector('.forge-render')).toBeTruthy()
    expect(container.textContent).toContain('Quickness Firebrand')
  })

  it('renders party lines and pool cards for comp-card payloads', async () => {
    const comp = {
      title: 'GvG Mainline',
      partyLines: [{ slots: ['b1'], capacity: 5 }],
      buildColors: {}
    }
    const { container } = render(
      <ForgeCard display={{ kind: 'comp-card', data: { comp, builds: { b1: build } } }} />
    )
    await waitFor(() => expect(container.querySelector('.comp-card')).toBeTruthy())
    expect(container.querySelectorAll('.comp-slot--filled')).toHaveLength(1)
    expect(container.querySelectorAll('.comp-slot--empty')).toHaveLength(4)
    expect(container.querySelector('.mini-card')).toBeTruthy()
  })
})
