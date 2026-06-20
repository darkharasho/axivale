// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichPositioning from './RichPositioning'

const fullData = {
  kind: 'positioning' as const,
  degree: 'full' as const,
  map: { sizes: [1000, 1000] as [number, number], inchToPixel: 1 },
  tagPath: [
    [0, 0],
    [500, 500]
  ] as [number, number][],
  squadMass: { x: 200, y: 200, r: 40 },
  deaths: [
    [800, 800],
    [810, 790]
  ] as [number, number][],
  downs: [[700, 700]] as [number, number][],
  spread: [
    [0, 200],
    [6, 1800],
    [10, 400]
  ] as [number, number][],
  peakSpread: 1800
}

describe('RichPositioning', () => {
  it('renders an svg for full-degree data', () => {
    const { container } = render(<RichPositioning data={fullData} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders peak spread value in the caption area', () => {
    const { container } = render(<RichPositioning data={fullData} />)
    expect(container.textContent).toMatch(/peak/i)
    expect(container.textContent).toContain('1800')
  })

  it('renders a no-replay note when degree is not full', () => {
    const { container } = render(
      <RichPositioning data={{ ...fullData, degree: 'coarse' as const }} />
    )
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toMatch(/no replay trajectories/i)
  })
})
