// @vitest-environment jsdom
// src/renderer/src/components/panels/Logs.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import Logs from './Logs'
import LogsNav from './LogsNav'
import { useLogs, LOGS_POLL_MS } from './useLogs'

// Harness mounting both the rail + detail over one controller, as App does.
function Harness({ active = true }: { active?: boolean }): ReactElement {
  const ctl = useLogs(active)
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

  // Important — displaying a fight needs neither the watched folder nor the
  // parser: it is four strings out of the registry. A user with no arcdps
  // install who drops a friend's log must see it, not "No arcdps log folder
  // found." forever. The rail and the detail pane must agree: anything the rail
  // lists must be clickable to something.
  it('shows a dropped fight even when there is no watched folder', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi
        .fn()
        .mockResolvedValue({ dir: null, dirExists: false, available: true, reason: null }),
      axilogList: vi.fn().mockResolvedValue([
        {
          logId: 'abc12345',
          path: '/drops/theirfight.zevtc',
          startedAt: '2026-08-30T21:14:32',
          mapFolder: 'drops',
          bytes: 1_500_000,
          source: 'opened'
        }
      ])
    })
    const { container } = render(<Harness />)
    const nav = within(await screen.findByRole('navigation'))
    fireEvent.click(await nav.findByText('drops'))
    const detail = within(container.querySelector('.sk2-detail') as HTMLElement)
    expect(await detail.findByText(/theirfight\.zevtc/)).toBeTruthy()
    expect(detail.getByText(/opened manually/i)).toBeTruthy()
    // The folder message is still shown — the two facts are independent.
    expect(detail.getByText(/no arcdps log folder found/i)).toBeTruthy()
  })

  it('shows the selected fight even when the native parser is unavailable', async () => {
    ;(window as unknown as { officer: unknown }).officer = officer({
      axilogStatus: vi.fn().mockResolvedValue({
        dir: '/logs',
        dirExists: true,
        available: false,
        reason: 'no prebuilt binary for linux-arm64'
      }),
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
    const { container } = render(<Harness />)
    const nav = within(await screen.findByRole('navigation'))
    fireEvent.click(await nav.findByText('World vs World'))
    const detail = within(container.querySelector('.sk2-detail') as HTMLElement)
    expect(await detail.findByText(/20260830-211432\.zevtc/)).toBeTruthy()
    expect(detail.getByText(/no prebuilt binary/i)).toBeTruthy()
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

  // Important — the hook is mounted at App level for the whole app lifetime, so
  // a single mount-time scan means the panel shows whatever existed at launch:
  // raid for three hours, open the Logs tab, see "No fights logged yet." — an
  // honest-sounding message that is false.
  it('does not scan while the logs section is not the active one', async () => {
    const of = officer()
    ;(window as unknown as { officer: unknown }).officer = of
    render(<Harness active={false} />)
    await waitFor(() => expect(screen.getByText(/loading/i)).toBeTruthy())
    expect(of.axilogList).not.toHaveBeenCalled()
  })

  it('rescans when the logs section becomes active', async () => {
    const of = officer()
    ;(window as unknown as { officer: unknown }).officer = of
    const { rerender } = render(<Harness active={false} />)
    expect(of.axilogList).not.toHaveBeenCalled()
    rerender(<Harness active={true} />)
    await waitFor(() => expect(of.axilogList).toHaveBeenCalledTimes(1))
  })

  it('polls while the section stays active and stops when it is no longer active', async () => {
    vi.useFakeTimers()
    try {
      const of = officer()
      ;(window as unknown as { officer: unknown }).officer = of
      const { rerender, unmount } = render(<Harness active={true} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(of.axilogList).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOGS_POLL_MS)
      })
      expect(of.axilogList).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOGS_POLL_MS)
      })
      expect(of.axilogList).toHaveBeenCalledTimes(3)

      // Leaving the section must clear the interval — a leaked interval
      // scanning the filesystem forever is worse than the bug being fixed.
      rerender(<Harness active={false} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOGS_POLL_MS * 3)
      })
      expect(of.axilogList).toHaveBeenCalledTimes(3)

      rerender(<Harness active={true} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(of.axilogList).toHaveBeenCalledTimes(4)
      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOGS_POLL_MS * 3)
      })
      expect(of.axilogList).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
