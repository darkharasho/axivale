// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CompSketch from './CompSketch'

describe('CompSketch', () => {
  it('renders title, a grid tile per slot, and a list row per build', () => {
    const { container, getByText } = render(
      <CompSketch
        spec={{
          title: 'WvW Zerg — 25',
          subtitle: '5 parties',
          subgroups: [[{ spec: 'Firebrand', role: 'support' }, { spec: 'Reaper', role: 'damage' }]],
          builds: [
            { spec: 'Firebrand', role: 'support', count: 5, weapons: 'Axe/Shield · Staff', note: 'Stability anchor' },
            { spec: 'Reaper', role: 'damage', count: 3 }
          ]
        }}
      />
    )
    expect(getByText('WvW Zerg — 25')).toBeTruthy()
    expect(container.querySelectorAll('.cs-tile')).toHaveLength(2)
    expect(container.querySelectorAll('.cs-build')).toHaveLength(2)
    expect(getByText('Axe/Shield · Staff')).toBeTruthy()
    expect(getByText('Stability anchor')).toBeTruthy()
    expect(getByText('×5')).toBeTruthy()
  })

  it('omits the grid when no subgroups are given (aggregate comp)', () => {
    const { container } = render(<CompSketch spec={{ builds: [{ spec: 'Scourge', role: 'damage', count: 2 }] }} />)
    expect(container.querySelector('.cs-grid')).toBeNull()
    expect(container.querySelectorAll('.cs-build')).toHaveLength(1)
  })
})
