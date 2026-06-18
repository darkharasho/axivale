// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichChart from './RichChart'

const spec = {
  type: 'bar' as const,
  title: 'Boon uptime',
  xKey: 'boon',
  series: [{ key: 'uptime', label: 'Uptime %' }],
  rows: [
    { boon: 'Might', uptime: 92 },
    { boon: 'Quickness', uptime: 71 }
  ]
}

describe('RichChart', () => {
  it('renders the title and an svg chart surface', () => {
    const { getByText, container } = render(<RichChart spec={spec} />)
    expect(getByText('Boon uptime')).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders one series element per series for line charts', () => {
    const { container } = render(
      <RichChart
        spec={{
          ...spec,
          type: 'line',
          series: [
            { key: 'uptime', label: 'Uptime %' },
            { key: 'target', label: 'Target %', color: '#6fae6f' }
          ]
        }}
      />
    )
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
  })

  it('renders a stale badge when stale', () => {
    const base = { type: 'line' as const, title: 'DPS', xKey: 'run', series: [{ key: 'dps', label: 'DPS' }], rows: [{ run: 'r1', dps: 5 }] }
    const { getByText } = render(<RichChart spec={{ ...base, stale: true, staleAge: '2d ago' }} />)
    expect(getByText('cached · 2d ago · source unreachable')).toBeTruthy()
  })
})
