// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import Roster from './Roster'
import RosterNav from './RosterNav'
import { useRoster } from './useRoster'
import type { RendererReconciledMember } from '../../../../preload/index.d'

function member(p: Partial<RendererReconciledMember>): RendererReconciledMember {
  return {
    memberId: 'm1',
    discordName: 'harasho',
    displayName: 'Bob',
    hasMemberRole: true,
    accounts: [{ account_name: 'harasho.4281', characters: ['Axi'], inGuild: true }],
    guildLabels: ['EWW'],
    linked: true,
    inGuild: true,
    status: 'verified',
    nickname: '',
    aliases: [],
    notes: '',
    tags: [],
    label: 'Bob',
    ...p
  }
}

function Harness(): ReactElement {
  const ctl = useRoster(true)
  return (
    <div>
      <RosterNav ctl={ctl} />
      <Roster ctl={ctl} />
    </div>
  )
}

function officer(over: Record<string, unknown> = {}) {
  return {
    rosterReconcile: vi.fn().mockResolvedValue([
      member({}),
      member({ memberId: 'm2', discordName: 'newbie', displayName: 'Newbie', label: 'Newbie', linked: false, inGuild: false, accounts: [], status: 'no-key' })
    ]),
    rosterAnnotationUpsert: vi.fn().mockResolvedValue(null),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Roster panel', () => {
  it('reconciles, lists members in the rail, and opens the first', async () => {
    render(<Harness />)
    // first member selected -> its nickname field is shown
    await screen.findByPlaceholderText(/preferred short name/i)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Bob')).toBeTruthy()
    expect(within(nav).getByText('Newbie')).toBeTruthy()
  })

  it('filters the rail by status with the chips', async () => {
    render(<Harness />)
    await screen.findByPlaceholderText(/preferred short name/i)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Bob')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /no key/i }))
    expect(within(nav).queryByText('Bob')).toBeNull()
    expect(within(nav).getByText('Newbie')).toBeTruthy()
  })

  it('saves an annotation for the selected member', async () => {
    const upsert = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { officer: unknown }).officer = officer({ rosterAnnotationUpsert: upsert })
    render(<Harness />)
    const nick = (await screen.findByPlaceholderText(/preferred short name/i)) as HTMLInputElement
    fireEvent.change(nick, { target: { value: 'Bobby' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith('m1', { nickname: 'Bobby', aliases: [], notes: '', tags: [] })
    )
  })
})
