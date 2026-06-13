// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Gw2GuildSwitcher } from './Masthead'

// Minimal window.officer stub — the switcher only touches getSetting,
// validateGw2Key and setSetting.
function makeOfficer(overrides: Partial<typeof window.officer> = {}): typeof window.officer {
  return {
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    validateGw2Key: vi.fn().mockResolvedValue({ ok: false }),
    listKeys: vi.fn().mockResolvedValue([])
  } as unknown as typeof window.officer
}

const GUILDS = [
  { id: 'g-aaa', name: 'Alpha', tag: 'AAA', leader: true },
  { id: 'g-bbb', name: 'Bravo', tag: 'BBB', leader: false }
]

beforeEach(() => {
  window.officer = makeOfficer()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Gw2GuildSwitcher', () => {
  it('shows the saved gw2GuildName when closed', async () => {
    window.officer.getSetting = vi.fn().mockImplementation(async (k: string) =>
      k === 'gw2GuildName' ? 'Alpha [AAA]' : k === 'gw2GuildId' ? 'g-aaa' : null
    )
    await act(async () => {
      render(<Gw2GuildSwitcher onSwitched={() => {}} />)
    })
    expect(screen.getByText('Alpha [AAA]')).toBeTruthy()
  })

  it('falls back to "no guild" when nothing is saved', async () => {
    await act(async () => {
      render(<Gw2GuildSwitcher onSwitched={() => {}} />)
    })
    expect(screen.getByText('no guild')).toBeTruthy()
  })

  it('validates the key on open and lists every guild', async () => {
    const validate = vi.fn().mockResolvedValue({ ok: true, info: { guilds: GUILDS } })
    window.officer.validateGw2Key = validate
    window.officer.getSetting = vi.fn().mockResolvedValue(null)

    await act(async () => {
      render(<Gw2GuildSwitcher onSwitched={() => {}} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(validate).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Alpha/)).toBeTruthy()
    expect(screen.getByText(/Bravo/)).toBeTruthy()
  })

  it('persists id + name and calls onSwitched when a guild is picked', async () => {
    window.officer.validateGw2Key = vi.fn().mockResolvedValue({ ok: true, info: { guilds: GUILDS } })
    window.officer.getSetting = vi.fn().mockResolvedValue(null)
    const setSetting = vi.fn().mockResolvedValue(undefined)
    window.officer.setSetting = setSetting
    const onSwitched = vi.fn()

    await act(async () => {
      render(<Gw2GuildSwitcher onSwitched={onSwitched} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText(/Bravo/))
    })
    expect(setSetting).toHaveBeenCalledWith('gw2GuildId', 'g-bbb')
    expect(setSetting).toHaveBeenCalledWith('gw2GuildName', 'Bravo [BBB]')
    expect(onSwitched).toHaveBeenCalledTimes(1)
  })

  it('shows the error when validation fails', async () => {
    window.officer.validateGw2Key = vi.fn().mockResolvedValue({ ok: false, error: 'no GW2 key' })
    window.officer.getSetting = vi.fn().mockResolvedValue(null)

    await act(async () => {
      render(<Gw2GuildSwitcher onSwitched={() => {}} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(screen.getByText('no GW2 key')).toBeTruthy()
  })
})
