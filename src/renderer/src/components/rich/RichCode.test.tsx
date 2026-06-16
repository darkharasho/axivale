// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichCode from './RichCode'

describe('RichCode', () => {
  it('renders the title and preformatted text', () => {
    const { getByText, container } = render(<RichCode spec={{ title: 'Totals', text: '{\n  "a": 1\n}' }} />)
    expect(getByText('Totals')).toBeTruthy()
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('"a": 1')
  })
})
