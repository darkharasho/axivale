// @vitest-environment jsdom
// src/renderer/src/components/panels/Meta.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import Meta from './Meta'

function officer() {
  let progressCb: ((e: unknown) => void) | null = null
  return {
    metaList: () =>
      Promise.resolve([
        {
          id: '1',
          mode: 'WvW',
          notes: 'Scourge + Firebrand core.',
          refreshedAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '',
          sources: [
            { label: 'MetaBattle', url: 'https://metabattle.com', status: 'ok', fetchedAt: '2026-06-10T00:00:00.000Z', error: null },
            { label: 'Hardstuck', url: 'https://hardstuck.gg', status: 'error', fetchedAt: null, error: 'timeout' },
            { label: 'gw2mists', url: 'https://gw2mists.com', status: 'never', fetchedAt: null, error: null }
          ]
        }
      ]),
    onMetaProgress: (cb: (e: unknown) => void) => {
      progressCb = cb
      return () => {}
    },
    __fire: (e: unknown) => progressCb?.(e)
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Meta panel (read-only)', () => {
  it('renders the distilled summary and source chips', async () => {
    render(<Meta />)
    expect(await screen.findByText('WvW')).toBeTruthy()
    expect(screen.getByText('Scourge + Firebrand core.')).toBeTruthy()
    expect(screen.getByText('MetaBattle')).toBeTruthy()
    expect(screen.getByText('ok')).toBeTruthy()
    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByText('never')).toBeTruthy()
  })

  it('has no editor — no textbox and no save button', async () => {
    render(<Meta />)
    await screen.findByText('WvW')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('shows a refreshing indicator while a mode is in progress', async () => {
    const o = officer()
    ;(window as unknown as { officer: unknown }).officer = o
    render(<Meta />)
    await screen.findByText('WvW')
    act(() => {
      ;(o as unknown as { __fire: (e: unknown) => void }).__fire({ type: 'mode-start', modeId: '1' })
    })
    expect(screen.getByText(/refreshing/i)).toBeTruthy()
  })
})
