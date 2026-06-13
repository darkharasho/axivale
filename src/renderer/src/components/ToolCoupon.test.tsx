// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ToolCoupon from './ToolCoupon'
import type { ToolCall } from '../state'

function doneTool(extra: Partial<ToolCall>): ToolCall {
  return { id: 't1', name: 'gw2_api', input: {}, resultText: '{"ok":true}', isError: false, ...extra }
}

describe('ToolCoupon rich displays', () => {
  it('renders a table block instead of the generic body when display.kind=table', () => {
    const { container, getByText } = render(
      <ToolCoupon
        tool={doneTool({
          display: {
            kind: 'table',
            data: { title: 'Roster', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
          }
        })}
      />
    )
    expect(container.querySelector('.richtable')).toBeTruthy()
    expect(getByText('Tessa')).toBeTruthy()
    expect(container.querySelector('.manifest')).toBeNull()
  })

  it('renders a chart block when display.kind=chart', () => {
    const { container } = render(
      <ToolCoupon
        tool={doneTool({
          display: {
            kind: 'chart',
            data: { type: 'bar', title: 'Kills', xKey: 'day', series: [{ key: 'k', label: 'Kills' }], rows: [{ day: 'Mon', k: 4 }] }
          }
        })}
      />
    )
    expect(container.querySelector('.richchart svg')).toBeTruthy()
  })

  it('falls back to the generic body when there is no display', () => {
    const { container } = render(<ToolCoupon tool={doneTool({})} />)
    expect(container.querySelector('.manifest')).toBeTruthy()
  })
})
