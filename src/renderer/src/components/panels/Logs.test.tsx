// @vitest-environment jsdom
// src/renderer/src/components/panels/Logs.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    axilogStatus: vi
      .fn()
      .mockResolvedValue({ dir: '/logs', dirExists: true, available: true, reason: null }),
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
      axilogStatus: vi
        .fn()
        .mockResolvedValue({ dir: '/logs', dirExists: true, available: true, reason: null }),
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
    const nav = within(await screen.findByRole('navigation'))
    expect(await nav.findByText(/World vs World/)).toBeTruthy()
    expect(nav.getByText(/21:14/)).toBeTruthy()
  })

  it('offers the folder picker when no log dir was found', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi
        .fn()
        .mockResolvedValue({ dir: null, dirExists: false, available: true, reason: null }),
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
        dirExists: true,
        available: false,
        reason: 'no prebuilt binary for linux-arm64'
      }),
      axilogList: vi.fn().mockResolvedValue([])
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/no prebuilt binary/i)).toBeTruthy())
  })

  // Critical 1 — the two conditions must render independently. A machine with
  // no prebuilt binary AND no detected folder must be told BOTH things, not
  // just one hiding the other.
  it('shows both the parser-unavailable reason and the folder picker when both are true', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockResolvedValue({
        dir: null,
        dirExists: false,
        available: false,
        reason: 'no prebuilt binary for linux-arm64'
      }),
      axilogList: vi.fn().mockResolvedValue([])
    })
    render(<Harness />)
    expect(await screen.findByText(/no prebuilt binary/i)).toBeTruthy()
    expect(screen.getByText(/no arcdps log folder found/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /choose folder/i })).toBeTruthy()
  })

  // Critical 2 — a since-deleted/renamed configured folder must say so, not
  // render as an empty "no fights" list, and the picker must be reachable to
  // recover from it.
  it('says the configured log folder no longer exists, with a picker to recover', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi
        .fn()
        .mockResolvedValue({ dir: '/gone', dirExists: false, available: true, reason: null }),
      axilogList: vi.fn().mockResolvedValue([])
    })
    const { container } = render(<Harness />)
    const detail = within(container.querySelector('.sk2-detail') as HTMLElement)
    expect(await detail.findByText(/log folder no longer exists/i)).toBeTruthy()
    expect(detail.getByText(/\/gone/)).toBeTruthy()
    expect(detail.getByRole('button', { name: /choose folder/i })).toBeTruthy()
  })

  // Critical 2 — the picker must also be reachable from a fully-healthy state,
  // not just the null-dir dead end.
  it('keeps the folder picker reachable even when everything is fine', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi
        .fn()
        .mockResolvedValue({ dir: '/logs', dirExists: true, available: true, reason: null }),
      axilogList: vi.fn().mockResolvedValue([])
    })
    render(<Harness />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose folder/i })).toBeTruthy()
    )
  })

  // Important 3 — a rejecting axilogStatus() must render as a failure, not as
  // a false "no folder found" (and must not produce an unhandled rejection).
  it('renders a failure state when status fails to load, not a false no-folder message', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockRejectedValue(new Error('ipc boom')),
      axilogList: vi.fn().mockResolvedValue([])
    })
    render(<Harness />)
    await waitFor(() => expect(screen.getByText(/ipc boom/i)).toBeTruthy())
    expect(screen.queryByText(/no arcdps log folder found/i)).toBeNull()
  })

  // Important 4 — the pre-resolution paint must be visibly distinct from a
  // real "no folder" state.
  it('shows a neutral loading state before status resolves, not "no folder"', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockReturnValue(new Promise(() => {})),
      axilogList: vi.fn().mockReturnValue(new Promise(() => {}))
    })
    render(<Harness />)
    expect(await screen.findByText(/checking/i)).toBeTruthy()
    expect(screen.queryByText(/no arcdps log folder found/i)).toBeNull()
  })
})
