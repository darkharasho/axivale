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
  // Rich blocks (charts/tables/cards) render in the main article column, NOT
  // the narrow right rail. The rail's expanded notice shows the compact body.
  it('does NOT render a rich block in the rail; shows the generic body instead', () => {
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
    expect(container.querySelector('.richtable')).toBeNull()
    expect(container.querySelector('.richchart')).toBeNull()
    // The compact tool body is shown in the rail (manifest for the JSON result).
    expect(container.querySelector('.manifest')).toBeTruthy()
  })

  it('does NOT render a chart block in the rail', () => {
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
    expect(container.querySelector('.richchart')).toBeNull()
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
