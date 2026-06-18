// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import RichTable from './RichTable'

const spec = {
  title: 'WvW Roles',
  columns: [
    { key: 'name', label: 'Build' },
    { key: 'count', label: 'Count' }
  ],
  rows: [
    { name: 'Firebrand', count: 5 },
    { name: 'Scrapper', count: 3 },
    { name: 'Vindicator', count: 8 }
  ]
}

describe('RichTable', () => {
  it('renders title, headers, and all rows', () => {
    const { getByText, getAllByRole } = render(<RichTable spec={spec} />)
    expect(getByText('WvW Roles')).toBeTruthy()
    expect(getByText('Build')).toBeTruthy()
    expect(getAllByRole('row')).toHaveLength(4) // header + 3
  })

  it('sorts by column on header click, toggling direction', () => {
    const { getByText, getAllByRole } = render(<RichTable spec={spec} />)
    const firstCell = (): string => getAllByRole('row')[1].querySelector('td')!.textContent!
    fireEvent.click(getByText('Count'))
    expect(firstCell()).toBe('Scrapper') // ascending by count: 3
    fireEvent.click(getByText('Count'))
    expect(firstCell()).toBe('Vindicator') // descending: 8
  })

  it('renders missing cell values as an em dash', () => {
    const { getAllByRole } = render(
      <RichTable spec={{ columns: spec.columns, rows: [{ name: 'Druid' }] }} />
    )
    expect(getAllByRole('row')[1].textContent).toContain('—')
  })

  it('renders a stale badge with the exact text when stale', () => {
    const { getByText, queryByText } = render(
      <RichTable spec={{ ...spec, stale: true, staleAge: '3h ago' }} />
    )
    expect(getByText('cached · 3h ago · source unreachable')).toBeTruthy()
    const { container: c2 } = render(<RichTable spec={spec} />)
    expect(c2.querySelector('.rich-stale-badge')).toBeNull() // no badge when fresh
    expect(queryByText).toBeTruthy()
  })

  it('renders the badge even when the table has no title', () => {
    const { getByText } = render(
      <RichTable spec={{ columns: spec.columns, rows: spec.rows, stale: true, staleAge: 'unknown age' }} />
    )
    expect(getByText('cached · unknown age · source unreachable')).toBeTruthy()
  })
})
