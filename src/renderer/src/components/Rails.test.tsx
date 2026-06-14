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
  // An expanded notice renders the tool's actual rich card (table/chart) so the
  // heavy data lives in the Actions rail instead of the article body.
  it('renders the rich table card in the rail when a result has a display', () => {
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
    const { container } = render(
      <RightRail memberCount={null} buildsCount={null} turns={[turnWith(tool)]} />
    )
    fireEvent.click(container.querySelector('.ncard')!)
    expect(container.querySelector('.richtable')).toBeTruthy()
  })

  it('renders the rich chart card in the rail when a result has a chart display', () => {
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
    expect(container.querySelector('.richchart')).toBeTruthy()
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

  it('the expand button opens the modal without toggling the inline peek', () => {
    const tool: ToolCall = {
      id: 'tx',
      name: 'axibridge_player_stats',
      input: {},
      resultText: '{"ok":true}',
      isError: false,
      display: {
        kind: 'table',
        data: { title: 'Players', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
      }
    }
    const { container } = render(
      <RightRail memberCount={null} buildsCount={null} turns={[turnWith(tool)]} />
    )
    fireEvent.click(container.querySelector('.ncard .expand')!)
    // modal opened
    expect(container.querySelector('.action-modal')).toBeTruthy()
    // inline peek did NOT open (no .nx body inside the card)
    expect(container.querySelector('.ncard .nx')).toBeNull()
  })
})
