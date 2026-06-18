// @vitest-environment jsdom
// src/renderer/src/components/ActionModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ActionModal from './ActionModal'
import type { ToolCall } from '../state'

const tableTool: ToolCall = {
  id: 't1',
  name: 'axibridge_player_stats',
  input: { repo: 'guild/reports', from: 'tonight' },
  resultText: '{"raw":"payload"}',
  isError: false,
  display: {
    kind: 'table',
    data: { title: 'Players', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
  }
}

describe('ActionModal', () => {
  it('renders nothing when tool is null', () => {
    const { container } = render(<ActionModal tool={null} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the header, inputs, and the rich card', () => {
    render(<ActionModal tool={tableTool} onClose={() => {}} />)
    expect(screen.getByText(/players/i)).toBeTruthy() // column label from RichTable
    // inputs line includes a humanized input value
    expect(screen.getByText(/guild\/reports/)).toBeTruthy()
    // raw result is NOT shown until toggled
    expect(screen.queryByText('{"raw":"payload"}')).toBeNull()
  })

  it('toggles the raw result', () => {
    render(<ActionModal tool={tableTool} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /show raw/i }))
    expect(screen.getByText('{"raw":"payload"}')).toBeTruthy()
  })

  it('closes on the ✕, the footer button, and the backdrop — but not on panel click', () => {
    const onClose = vi.fn()
    const { container } = render(<ActionModal tool={tableTool} onClose={onClose} />)
    fireEvent.click(container.querySelector('.action-modal')!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(container.querySelector('.action-modal__x')!)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('.action-modal__foot .right')!)
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(container.querySelector('.action-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
