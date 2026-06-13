// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { RightRail } from './Rails'
import type { Turn, ToolCall } from '../state'

function turnWith(tool: ToolCall): Turn {
  return {
    id: 1,
    userText: 'show me',
    agentText: '',
    tools: [tool],
    done: true,
    error: null,
    filedAt: '12:00'
  }
}

describe('RightRail notice cards', () => {
  it('renders the rich block for a tool with a display payload', () => {
    const tool: ToolCall = {
      id: 't1',
      name: 'gw2_api',
      input: {},
      resultText: '{"ok":true}',
      isError: false,
      display: {
        kind: 'table',
        data: { title: 'Roster', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
      }
    }
    const { container, getByText } = render(
      <RightRail memberCount={null} buildsCount={null} turns={[turnWith(tool)]} />
    )
    fireEvent.click(container.querySelector('.ncard')!)
    expect(container.querySelector('.richtable')).toBeTruthy()
    expect(getByText('Tessa')).toBeTruthy()
    expect(container.querySelector('.manifest')).toBeNull()
  })

  it('renders a chart block when display.kind=chart', () => {
    const tool: ToolCall = {
      id: 't2',
      name: 'gw2_api',
      input: {},
      resultText: '{"ok":true}',
      isError: false,
      display: {
        kind: 'chart',
        data: {
          type: 'bar',
          title: 'Kills',
          xKey: 'day',
          series: [{ key: 'k', label: 'Kills' }],
          rows: [{ day: 'Mon', k: 4 }]
        }
      }
    }
    const { container } = render(
      <RightRail memberCount={null} buildsCount={null} turns={[turnWith(tool)]} />
    )
    fireEvent.click(container.querySelector('.ncard')!)
    expect(container.querySelector('.richchart svg')).toBeTruthy()
  })

  it('falls back to the generic body when there is no display', () => {
    const tool: ToolCall = {
      id: 't3',
      name: 'gw2_api',
      input: {},
      resultText: '{"ok":true}',
      isError: false
    }
    const { container } = render(
      <RightRail memberCount={null} buildsCount={null} turns={[turnWith(tool)]} />
    )
    fireEvent.click(container.querySelector('.ncard')!)
    expect(container.querySelector('.manifest')).toBeTruthy()
    expect(container.querySelector('.rich')).toBeNull()
  })
})
