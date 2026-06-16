// src/main/rosterReconcile.ts
//
// Merges the identity signals a guild has into one reconciled roster. The
// in-game GW2 guild roster is the base when available (GW2-first): every guild
// account is a row, with its Discord identity matched on top via a manual link
// first, then the AxiTools auto-link. Discord members who aren't in the in-game
// roster (no-key / left-guild) come after. When there's no in-game roster we
// fall back to seeding from the AxiTools-linked members. Kept pure (no IO) so
// the merge is unit-testable; the IPC layer fetches the raw sources.

export interface DiscordMemberRaw {
  id: string
  name?: string
  display_name?: string
  roles?: string[]
}

export interface LinkedAccountRaw {
  account_name?: string
  characters?: string[]
  guild_labels?: Record<string, string>
}

export interface LinkedMemberRaw {
  member_id: string
  member_name?: string
  accounts?: LinkedAccountRaw[]
}

export interface InGameMemberRaw {
  name: string
  rank?: string
  joined?: string | null
}

export interface ManualLinkRaw {
  accountName: string
  memberId: string
}

export interface AnnotationRaw {
  memberId: string
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
}

export interface ReconciledAccount {
  account_name: string
  characters: string[]
  inGuild: boolean
}

/** Reconciliation state, used for the rail LED + filter chips. */
export type RosterStatus =
  | 'verified' // in the in-game guild + matched to a Discord member
  | 'linked' // matched to a Discord member, in-game status unconfirmed
  | 'no-key' // a Discord guild member who never linked a GW2 key
  | 'left-guild' // matched to a Discord member, but not in the in-game guild roster
  | 'unlinked' // in the in-game guild, but no Discord member matched

export interface ReconciledMember {
  memberId: string | null
  discordName?: string
  displayName?: string
  hasMemberRole: boolean
  accounts: ReconciledAccount[]
  accountName?: string
  rank?: string
  joined?: string | null
  linkSource: 'auto' | 'manual' | null
  guildLabels: string[]
  linked: boolean
  inGuild: boolean
  status: RosterStatus
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
  label: string
}

export interface ReconcileInput {
  discordMembers: DiscordMemberRaw[]
  linked: LinkedMemberRaw[]
  inGameRoster: InGameMemberRaw[]
  manualLinks: ManualLinkRaw[]
  annotations: AnnotationRaw[]
  /** Configured guild-member role id, or null/'' when unset. */
  memberRoleId: string | null
  /** Whether the in-game GW2 roster was actually fetched (drives GW2-first base). */
  haveInGame: boolean
}

const lc = (s: string): string => s.trim().toLowerCase()

function emptyAnn(memberId: string | null): AnnotationRaw {
  return { memberId: memberId ?? '', nickname: '', aliases: [], notes: '', tags: [] }
}

/** Index linked-member accounts by lower-cased account name -> { memberId, characters, labels }. */
function indexLinkedAccounts(linked: LinkedMemberRaw[]): Map<
  string,
  { memberId: string; characters: string[]; labels: string[] }
> {
  const m = new Map<string, { memberId: string; characters: string[]; labels: string[] }>()
  for (const l of linked) {
    for (const a of l.accounts ?? []) {
      if (!a.account_name) continue
      m.set(lc(a.account_name), {
        memberId: l.member_id,
        characters: a.characters ?? [],
        labels: Object.values(a.guild_labels ?? {})
      })
    }
  }
  return m
}

export function reconcileRoster(input: ReconcileInput): ReconciledMember[] {
  const { discordMembers, linked, inGameRoster, manualLinks, annotations, memberRoleId, haveInGame } =
    input
  const roleConfigured = Boolean(memberRoleId)
  const discordById = new Map(discordMembers.map((d) => [d.id, d]))
  const annByMember = new Map(annotations.map((a) => [a.memberId, a]))
  const manualByAccount = new Map(manualLinks.map((l) => [lc(l.accountName), l.memberId]))
  const linkedByAccount = indexLinkedAccounts(linked)
  const hasMemberRole = (memberId: string): boolean =>
    roleConfigured ? (discordById.get(memberId)?.roles ?? []).includes(memberRoleId as string) : false

  // Fallback path: no in-game roster — seed from linked members (Phase C behavior).
  if (!haveInGame) return reconcileFromLinked(input)

  const out: ReconciledMember[] = []
  const placedMembers = new Set<string>()

  // 1. GW2-first base: one row per in-game guild account, Discord matched on top.
  for (const gm of inGameRoster) {
    const acctLc = lc(gm.name)
    const manualMember = manualByAccount.get(acctLc)
    const auto = linkedByAccount.get(acctLc)
    const memberId = manualMember ?? auto?.memberId ?? null
    const linkSource: 'auto' | 'manual' | null = manualMember ? 'manual' : auto ? 'auto' : null
    const discord = memberId ? discordById.get(memberId) : undefined
    const ann = annByMember.get(memberId ?? '') ?? emptyAnn(memberId)
    if (memberId) placedMembers.add(memberId)

    out.push({
      memberId,
      discordName: discord?.name,
      displayName: discord?.display_name,
      hasMemberRole: memberId ? hasMemberRole(memberId) : false,
      accounts: [{ account_name: gm.name, characters: auto?.characters ?? [], inGuild: true }],
      accountName: gm.name,
      rank: gm.rank,
      joined: gm.joined ?? null,
      linkSource,
      guildLabels: auto?.labels ?? [],
      linked: Boolean(memberId),
      inGuild: true,
      status: memberId ? 'verified' : 'unlinked',
      nickname: ann.nickname,
      aliases: ann.aliases,
      notes: ann.notes,
      tags: ann.tags,
      label: ann.nickname || discord?.display_name || discord?.name || gm.name
    })
  }

  // 2. Discord members not represented by an in-game account: linked-but-not-in-guild
  //    (left-guild) and role-holders with no key (no-key). Role-gated like the roster.
  for (const link of linked) {
    if (placedMembers.has(link.member_id)) continue
    if (roleConfigured && !hasMemberRole(link.member_id)) continue
    const accounts = (link.accounts ?? [])
      .map((a) => a.account_name)
      .filter((n): n is string => Boolean(n))
      .map((name) => ({
        account_name: name,
        characters: link.accounts?.find((a) => a.account_name === name)?.characters ?? [],
        inGuild: false
      }))
    pushSecondary(out, {
      memberId: link.member_id,
      discord: discordById.get(link.member_id),
      memberName: link.member_name,
      accounts,
      guildLabels: [...new Set((link.accounts ?? []).flatMap((a) => Object.values(a.guild_labels ?? {})))],
      hasRole: hasMemberRole(link.member_id),
      ann: annByMember.get(link.member_id) ?? emptyAnn(link.member_id),
      status: accounts.length ? 'left-guild' : 'no-key'
    })
    placedMembers.add(link.member_id)
  }

  // 3. Role-holding Discord members who never linked a key at all.
  if (roleConfigured) {
    for (const dm of discordMembers) {
      if (placedMembers.has(dm.id)) continue
      if (!(dm.roles ?? []).includes(memberRoleId as string)) continue
      pushSecondary(out, {
        memberId: dm.id,
        discord: dm,
        accounts: [],
        guildLabels: [],
        hasRole: true,
        ann: annByMember.get(dm.id) ?? emptyAnn(dm.id),
        status: 'no-key'
      })
      placedMembers.add(dm.id)
    }
  }

  return sortRoster(out)
}

function pushSecondary(
  out: ReconciledMember[],
  o: {
    memberId: string
    discord?: DiscordMemberRaw
    memberName?: string
    accounts: ReconciledAccount[]
    guildLabels: string[]
    hasRole: boolean
    ann: AnnotationRaw
    status: RosterStatus
  }
): void {
  const discordName = o.discord?.name ?? o.memberName
  out.push({
    memberId: o.memberId,
    discordName,
    displayName: o.discord?.display_name,
    hasMemberRole: o.hasRole,
    accounts: o.accounts,
    accountName: o.accounts[0]?.account_name,
    linkSource: o.accounts.length ? 'auto' : null,
    guildLabels: o.guildLabels,
    linked: o.accounts.length > 0,
    inGuild: false,
    status: o.status,
    nickname: o.ann.nickname,
    aliases: o.ann.aliases,
    notes: o.ann.notes,
    tags: o.ann.tags,
    label: o.ann.nickname || o.discord?.display_name || discordName || o.accounts[0]?.account_name || o.memberId
  })
}

function sortRoster(rows: ReconciledMember[]): ReconciledMember[] {
  return rows.sort((a, b) => a.label.localeCompare(b.label))
}

/** Fallback when the in-game roster isn't available: seed from AxiTools-linked
 *  members (Phase C behavior), still honoring manual links for the Discord match. */
function reconcileFromLinked(input: ReconcileInput): ReconciledMember[] {
  const { discordMembers, linked, manualLinks, annotations, memberRoleId } = input
  const roleConfigured = Boolean(memberRoleId)
  const discordById = new Map(discordMembers.map((d) => [d.id, d]))
  const annByMember = new Map(annotations.map((a) => [a.memberId, a]))
  const linkedByMember = new Set(linked.map((l) => l.member_id))
  const manualByMember = new Map<string, string[]>()
  for (const l of manualLinks) {
    const arr = manualByMember.get(l.memberId) ?? []
    arr.push(l.accountName)
    manualByMember.set(l.memberId, arr)
  }
  const hasMemberRole = (id: string): boolean =>
    roleConfigured ? (discordById.get(id)?.roles ?? []).includes(memberRoleId as string) : false

  const out: ReconciledMember[] = []
  for (const link of linked) {
    const dm = discordById.get(link.member_id)
    const accounts: ReconciledAccount[] = (link.accounts ?? [])
      .map((a) => a.account_name)
      .filter((n): n is string => Boolean(n))
      .map((name) => ({
        account_name: name,
        characters: link.accounts?.find((a) => a.account_name === name)?.characters ?? [],
        inGuild: false
      }))
    const ann = annByMember.get(link.member_id) ?? emptyAnn(link.member_id)
    const discordName = dm?.name ?? link.member_name
    out.push({
      memberId: link.member_id,
      discordName,
      displayName: dm?.display_name,
      hasMemberRole: hasMemberRole(link.member_id),
      accounts,
      accountName: accounts[0]?.account_name,
      linkSource: accounts.length ? 'auto' : null,
      guildLabels: [...new Set((link.accounts ?? []).flatMap((a) => Object.values(a.guild_labels ?? {})))],
      linked: accounts.length > 0,
      inGuild: false,
      status: accounts.length ? 'linked' : 'no-key',
      nickname: ann.nickname,
      aliases: ann.aliases,
      notes: ann.notes,
      tags: ann.tags,
      label: ann.nickname || dm?.display_name || discordName || accounts[0]?.account_name || link.member_id
    })
  }
  if (roleConfigured) {
    for (const dm of discordMembers) {
      if (linkedByMember.has(dm.id)) continue
      if (!(dm.roles ?? []).includes(memberRoleId as string)) continue
      const ann = annByMember.get(dm.id) ?? emptyAnn(dm.id)
      out.push({
        memberId: dm.id,
        discordName: dm.name,
        displayName: dm.display_name,
        hasMemberRole: true,
        accounts: [],
        linkSource: null,
        guildLabels: [],
        linked: false,
        inGuild: false,
        status: 'no-key',
        nickname: ann.nickname,
        aliases: ann.aliases,
        notes: ann.notes,
        tags: ann.tags,
        label: ann.nickname || dm.display_name || dm.name || dm.id
      })
    }
  }
  return sortRoster(out)
}
