// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import Editions from './Editions'
import type { EditionItem } from './Editions'

function conv(over: Partial<EditionItem> = {}): EditionItem {
  return {
    id: 'c1',
    title: null,
    updatedAt: new Date().toISOString(),
    turns: [],
    dispatchCount: 0,
    fresh: false,
    ...over
  }
}


function baseProps(items: EditionItem[]) {
  return {
    items,
    activeId: null as string | null,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn()
  }
}

describe('Editions', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('groups by Today and Earlier from updatedAt', () => {
    const today = conv({ id: 'a', updatedAt: new Date().toISOString() })
    const earlier = conv({ id: 'b', updatedAt: '2020-01-01T00:00:00.000Z' })
    const { getByText } = render(<Editions {...baseProps([today, earlier])} />)
    expect(getByText('Today')).toBeTruthy()
    expect(getByText('Earlier')).toBeTruthy()
  })

  it('shows an auto headline from the first done AI turn', () => {
    const item = conv({
      turns: [
        {
          id: 1,
          userText: 'how many?',
          agentText: 'Twelve members are on the books. The rest are details.',
          tools: [],
          done: true,
          error: null,
          filedAt: '12:00'
        }
      ],
      dispatchCount: 1
    })
    const { getByText } = render(<Editions {...baseProps([item])} />)
    expect(getByText('Twelve members are on the books.')).toBeTruthy()
  })

  it('falls back to the first user line, then Untitled dispatch', () => {
    const userOnly = conv({
      id: 'u',
      turns: [
        { id: 1, userText: 'roster please', agentText: '', tools: [], done: false, error: null, filedAt: '1' }
      ]
    })
    const empty = conv({ id: 'e', turns: [] })
    const { getByText } = render(<Editions {...baseProps([userOnly, empty])} />)
    expect(getByText('roster please')).toBeTruthy()
    expect(getByText('Untitled dispatch')).toBeTruthy()
  })

  it('prefers an explicit title over the auto headline', () => {
    const item = conv({ title: 'Weekly muster', turns: [] })
    const { getByText } = render(<Editions {...baseProps([item])} />)
    expect(getByText('Weekly muster')).toBeTruthy()
  })

  it('filters by the search box', () => {
    const a = conv({ id: 'a', title: 'Roster review' })
    const b = conv({ id: 'b', title: 'Build audit' })
    const { getByPlaceholderText, queryByText } = render(<Editions {...baseProps([a, b])} />)
    fireEvent.change(getByPlaceholderText('Search editions'), { target: { value: 'build' } })
    expect(queryByText('Build audit')).toBeTruthy()
    expect(queryByText('Roster review')).toBeNull()
  })

  it('marks the active row', () => {
    const a = conv({ id: 'a', title: 'A' })
    const props = { ...baseProps([a]), activeId: 'a' }
    const { container } = render(<Editions {...props} />)
    expect(container.querySelector('.edition.active')).toBeTruthy()
  })

  it('calls onSelect when a row is clicked', () => {
    const a = conv({ id: 'a', title: 'A' })
    const props = baseProps([a])
    const { getByText } = render(<Editions {...props} />)
    fireEvent.click(getByText('A'))
    expect(props.onSelect).toHaveBeenCalledWith('a')
  })

  it('calls onNew when New dispatch is clicked', () => {
    const props = baseProps([])
    const { getByText } = render(<Editions {...props} />)
    fireEvent.click(getByText('+ New dispatch'))
    expect(props.onNew).toHaveBeenCalled()
  })

  it('renames inline on submit', () => {
    const a = conv({ id: 'a', title: 'Old' })
    const props = baseProps([a])
    const { container, getByDisplayValue } = render(<Editions {...props} />)
    fireEvent.click(within(container.querySelector('.edition') as HTMLElement).getByTitle('Rename'))
    const input = getByDisplayValue('Old') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('a', 'New name')
  })

  it('confirms before delete', () => {
    const a = conv({ id: 'a', title: 'A' })
    const props = baseProps([a])
    const { container } = render(<Editions {...props} />)
    fireEvent.click(within(container.querySelector('.edition') as HTMLElement).getByTitle('Delete'))
    expect(window.confirm).toHaveBeenCalled()
    expect(props.onDelete).toHaveBeenCalledWith('a')
  })

  it('shows the hot-off-the-press kicker for fresh editions', () => {
    const a = conv({ id: 'a', title: 'A', fresh: true })
    const { getByText } = render(<Editions {...baseProps([a])} />)
    expect(getByText('✦ Hot off the press')).toBeTruthy()
  })
})
