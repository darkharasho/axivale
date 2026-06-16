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
    annotationKey: 'm1',
    discordName: 'harasho',
    displayName: 'Bob',
    hasMemberRole: true,
    accounts: [{ account_name: 'harasho.4281', characters: ['Axi'], inGuild: true, manual: false }],
    accountName: 'harasho.4281',
    rank: 'Officer',
    joined: '2024-11-01',
    linkSource: 'auto',
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

const unlinked = member({
  memberId: null,
  annotationKey: 'acct:Ghost.0000',
  discordName: undefined,
  displayName: undefined,
  hasMemberRole: false,
  accounts: [{ account_name: 'Ghost.0000', characters: [], inGuild: true, manual: false }],
  accountName: 'Ghost.0000',
  rank: 'Member',
  linkSource: null,
  linked: false,
  status: 'unlinked',
  label: 'Ghost.0000'
})

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
    rosterReconcile: vi.fn().mockResolvedValue([member({}), unlinked]),
    rosterAnnotationUpsert: vi.fn().mockResolvedValue(null),
    rosterLinkSet: vi.fn().mockResolvedValue({ accountName: 'Ghost.0000', memberId: 'm9', createdAt: '' }),
    rosterLinkDelete: vi.fn().mockResolvedValue(undefined),
    axitools: vi.fn().mockResolvedValue({
      roles: [],
      members: [{ id: 'm9', name: 'ghosty', display_name: 'Ghosty' }]
    }),
    ...over
  }
}

beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('Roster panel (GW2-first + manual links)', () => {
  it('lists members in the rail and opens the first', async () => {
    render(<Harness />)
    await screen.findByPlaceholderText(/preferred short name/i)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Bob')).toBeTruthy()
    expect(within(nav).getByText('Ghost.0000')).toBeTruthy()
  })

  it('filters to unlinked accounts', async () => {
    render(<Harness />)
    await screen.findByPlaceholderText(/preferred short name/i)
    const nav = screen.getByRole('navigation')
    fireEvent.click(screen.getByRole('button', { name: /unlinked/i }))
    expect(within(nav).queryByText('Bob')).toBeNull()
    expect(within(nav).getByText('Ghost.0000')).toBeTruthy()
  })

  it('manually links a Discord user to an unlinked GW2 account', async () => {
    const linkSet = vi.fn().mockResolvedValue({ accountName: 'Ghost.0000', memberId: 'm9', createdAt: '' })
    ;(window as unknown as { officer: unknown }).officer = officer({ rosterLinkSet: linkSet })
    render(<Harness />)
    await screen.findByPlaceholderText(/preferred short name/i)
    const nav = screen.getByRole('navigation')
    fireEvent.click(within(nav).getByText('Ghost.0000'))
    // open the Discord-user picker and choose Ghosty
    fireEvent.click(await screen.findByText(/pick a discord user/i))
    fireEvent.click(await screen.findByText(/Ghosty \(ghosty\)/))
    await waitFor(() => expect(linkSet).toHaveBeenCalledWith('Ghost.0000', 'm9'))
  })

  it('annotates an unlinked GW2 account (anchored on the account)', async () => {
    const upsert = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { officer: unknown }).officer = officer({ rosterAnnotationUpsert: upsert })
    render(<Harness />)
    await screen.findByPlaceholderText(/preferred short name/i)
    const nav = screen.getByRole('navigation')
    fireEvent.click(within(nav).getByText('Ghost.0000'))
    const nick = (await screen.findByPlaceholderText(/preferred short name/i)) as HTMLInputElement
    fireEvent.change(nick, { target: { value: 'Spook' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith('acct:Ghost.0000', { nickname: 'Spook', aliases: [], notes: '', tags: [] })
    )
  })

  it('shows a per-account unlink only for manual accounts and unlinks that account', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const folded = member({
      accounts: [
        { account_name: 'harasho.4281', characters: [], inGuild: true, manual: false },
        { account_name: 'gloom.2415', characters: [], inGuild: true, manual: true }
      ],
      linkSource: 'manual'
    })
    ;(window as unknown as { officer: unknown }).officer = officer({
      rosterReconcile: vi.fn().mockResolvedValue([folded]),
      rosterLinkDelete: del
    })
    render(<Harness />)
    await screen.findByPlaceholderText(/preferred short name/i)
    const unlinkBtns = screen.getAllByRole('button', { name: /^unlink$/i })
    expect(unlinkBtns).toHaveLength(1) // only the manual account (gloom.2415)
    fireEvent.click(unlinkBtns[0])
    await waitFor(() => expect(del).toHaveBeenCalledWith('gloom.2415'))
  })

  it('saves an annotation for a linked member', async () => {
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
