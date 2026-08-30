// @vitest-environment jsdom
// src/renderer/src/components/InputBar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InputBar from './InputBar'

function makeFile(name: string): File {
  return new File(['x'], name)
}

// fireEvent.drop just sets these properties on the synthetic event — jsdom
// doesn't implement a real DataTransfer/drag stack, so we hand-build the
// minimum shape InputBar reads (files + items).
function fileDrop(files: File[]) {
  return {
    dataTransfer: {
      files,
      items: files.map((f) => ({ kind: 'file', type: f.type || '' })),
      types: files.length ? ['Files'] : []
    }
  }
}

function textDrop(text: string) {
  return {
    dataTransfer: {
      files: [],
      items: [{ kind: 'string', type: 'text/plain' }],
      types: ['text/plain'],
      getData: () => text
    }
  }
}

function officer(over: Record<string, unknown> = {}) {
  return {
    axilogPathForFile: vi.fn((f: File) => `/logs/${f.name}`),
    axilogOpenFile: vi.fn().mockResolvedValue({
      logId: 'abc12345',
      path: '/logs/a.zevtc',
      startedAt: '2026-08-30T21:14:32',
      mapFolder: 'World vs World',
      bytes: 100,
      source: 'opened'
    }),
    ...over
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('InputBar drag-drop', () => {
  it('lets a text/URL drop through untouched (does not cancel the default action)', () => {
    render(<InputBar disabled={false} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox')
    const off = officer()
    ;(window as unknown as { officer: unknown }).officer = off
    const notCancelled = fireEvent.drop(field, textDrop('hello world'))
    // fireEvent's return value is `!event.defaultPrevented`.
    expect(notCancelled).toBe(true)
    expect(off.axilogPathForFile).not.toHaveBeenCalled()
  })

  it('seeds the message with the log id when a .zevtc is dropped', async () => {
    render(<InputBar disabled={false} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.drop(field, fileDrop([makeFile('20260830-211432.zevtc')]))
    await vi.waitFor(() => expect(field.value).toContain('abc12345'))
  })

  it('shows a message and makes no calls when the dropped file has the wrong extension', async () => {
    const off = officer()
    ;(window as unknown as { officer: unknown }).officer = off
    render(<InputBar disabled={false} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.drop(field, fileDrop([makeFile('screenshot.png')]))
    await vi.waitFor(() => expect(screen.getByText(/\.zevtc|\.evtc/i)).toBeTruthy())
    expect(off.axilogPathForFile).not.toHaveBeenCalled()
    expect(field.value).toBe('')
  })

  it('registers every matching log in a multi-file drop, not just the first', async () => {
    const off = officer({
      axilogOpenFile: vi
        .fn()
        .mockResolvedValueOnce({
          logId: 'aaa11111',
          path: '/logs/a.zevtc',
          startedAt: '2026-08-30T21:14:32',
          mapFolder: 'WvW',
          bytes: 10,
          source: 'opened'
        })
        .mockResolvedValueOnce({
          logId: 'bbb22222',
          path: '/logs/b.evtc.zip',
          startedAt: '2026-08-30T22:00:00',
          mapFolder: 'Raid',
          bytes: 10,
          source: 'opened'
        })
    })
    ;(window as unknown as { officer: unknown }).officer = off
    render(<InputBar disabled={false} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.drop(field, fileDrop([makeFile('a.zevtc'), makeFile('b.evtc.zip')]))
    await vi.waitFor(() => {
      expect(field.value).toContain('aaa11111')
      expect(field.value).toContain('bbb22222')
    })
    expect(off.axilogOpenFile).toHaveBeenCalledTimes(2)
  })

  it('reports failure instead of throwing when axilogPathForFile cannot resolve a path', async () => {
    const off = officer({ axilogPathForFile: vi.fn().mockReturnValue('') })
    ;(window as unknown as { officer: unknown }).officer = off
    render(<InputBar disabled={false} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.drop(field, fileDrop([makeFile('a.zevtc')]))
    await vi.waitFor(() => expect(screen.getByText(/couldn.t add/i)).toBeTruthy())
    expect(off.axilogOpenFile).not.toHaveBeenCalled()
    expect(field.value).toBe('')
  })

  it('reports failure instead of an unhandled rejection when axilogOpenFile rejects', async () => {
    const off = officer({ axilogOpenFile: vi.fn().mockRejectedValue(new Error('ipc boom')) })
    ;(window as unknown as { officer: unknown }).officer = off
    render(<InputBar disabled={false} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.drop(field, fileDrop([makeFile('a.zevtc')]))
    await vi.waitFor(() => expect(screen.getByText(/couldn.t add/i)).toBeTruthy())
    expect(field.value).toBe('')
  })

  it('ignores a log drop while the composer is disabled', async () => {
    const off = officer()
    ;(window as unknown as { officer: unknown }).officer = off
    render(<InputBar disabled={true} onSubmit={vi.fn()} onStop={vi.fn()} skills={[]} />)
    const field = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.drop(field, fileDrop([makeFile('a.zevtc')]))
    await new Promise((r) => setTimeout(r, 0))
    expect(off.axilogPathForFile).not.toHaveBeenCalled()
    expect(field.value).toBe('')
  })
})
