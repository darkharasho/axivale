// @vitest-environment jsdom
// src/renderer/src/components/panels/Logs.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import Logs from './Logs'
import LogsNav from './LogsNav'
import { useLogs } from './useLogs'

// Harness mounting both the rail + detail over one controller, as App does.
function Harness(): ReactElement {
  const ctl = useLogs()
  return (
    <div>
      <LogsNav ctl={ctl} />
      <Logs ctl={ctl} />
    </div>
  )
}

function officer(over: Record<string, unknown> = {}) {
  return {
    axilogList: vi.fn().mockResolvedValue([]),
    axilogStatus: vi.fn().mockResolvedValue({ dir: '/logs', available: true, reason: null, count: 0 }),
    axilogPickDir: vi.fn().mockResolvedValue(null),
    axilogOpenFile: vi.fn().mockResolvedValue(null),
    ...over
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Logs panel', () => {
  it('lists watched fights with their map and time', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockResolvedValue({ dir: '/logs', available: true, reason: null, count: 1 }),
      axilogList: vi.fn().mockResolvedValue([
        {
          logId: 'abc12345',
          path: '/logs/20260830-211432.zevtc',
          startedAt: '2026-08-30T21:14:32',
          mapFolder: 'World vs World',
          bytes: 1_500_000,
          source: 'watched'
        }
      ])
    })
    render(<Harness />)
    expect(await screen.findByText(/World vs World/)).toBeTruthy()
    expect(screen.getByText(/21:14/)).toBeTruthy()
  })

  it('offers the folder picker when no log dir was found', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockResolvedValue({ dir: null, available: true, reason: null, count: 0 }),
      axilogList: vi.fn().mockResolvedValue([])
    })
    render(<Harness />)
    expect(await screen.findByText(/no arcdps log folder found/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /choose folder/i })).toBeTruthy()
  })

  it('explains itself when the native parser is unavailable', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockResolvedValue({
        dir: '/logs',
        available: false,
        reason: 'no prebuilt binary for linux-arm64',
        count: 0
      }),
      axilogList: vi.fn().mockResolvedValue([])
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/no prebuilt binary/i)).toBeTruthy())
  })
})
