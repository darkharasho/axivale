// src/main/rosterReconcile.ts
//
// Merges the three identity signals a guild actually has — Discord membership
// (+roles), AxiTools GW2 links, and the in-game GW2 guild roster — plus the
// local annotations, into one reconciled roster the UI and agent can reason
// over. Kept pure (no IO) so the merge is unit-testable; the IPC layer fetches
// the raw sources and hands them in.

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
  /** True when this account appears in the in-game GW2 guild roster. */
  inGuild: boolean
}

/** Reconciliation state, used for the rail LED + filter chips. */
export type RosterStatus =
  | 'verified' // linked + confirmed in the in-game guild
  | 'linked' // has a GW2 key, but in-game roster wasn't available to confirm
  | 'no-key' // a Discord guild member who never linked a GW2 key
  | 'left-guild' // linked, but their account is not in the in-game guild roster
  | 'in-game-only' // in the in-game guild, but not matched to a Discord member

export interface ReconciledMember {
  /** Discord member id, or null for an in-game-only account with no Discord match. */
  memberId: string | null
  discordName?: string
  displayName?: string
  /** Whether they carry the configured guild-member role (false if no role configured). */
  hasMemberRole: boolean
  accounts: ReconciledAccount[]
  guildLabels: string[]
  linked: boolean
  inGuild: boolean
  status: RosterStatus
  /** Merged annotation fields (empty when none). */
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
  /** Best display label: nickname, else Discord display name/name, else account. */
  label: string
}

export interface ReconcileInput {
  discordMembers: DiscordMemberRaw[]
  linked: LinkedMemberRaw[]
  inGameAccounts: string[]
  annotations: AnnotationRaw[]
  /** Configured guild-member role id, or null/'' when unset. */
  memberRoleId: string | null
  /** Whether the in-game GW2 roster was actually fetched (gates left-guild/verified). */
  haveInGame: boolean
}

const lc = (s: string): string => s.trim().toLowerCase()

function emptyAnn(memberId: string | null): AnnotationRaw {
  return { memberId: memberId ?? '', nickname: '', aliases: [], notes: '', tags: [] }
}

export function reconcileRoster(input: ReconcileInput): ReconciledMember[] {
  const { discordMembers, linked, inGameAccounts, annotations, memberRoleId, haveInGame } = input
  const roleConfigured = Boolean(memberRoleId)
  const inGameSet = new Set(inGameAccounts.map(lc))
  const discordById = new Map(discordMembers.map((d) => [d.id, d]))
  const linkedByMember = new Set(linked.map((l) => l.member_id))
  const annByMember = new Map(annotations.map((a) => [a.memberId, a]))
  const matchedInGame = new Set<string>() // lc account names tied to a Discord member

  const out: ReconciledMember[] = []

  // 1. Seed from every linked member — this is the floor (the old roster). Discord
  //    role/name info is overlaid when the overview is available; missing overview
  //    never drops a linked member.
  for (const link of linked) {
    const dm = discordById.get(link.member_id)
    const hasMemberRole = roleConfigured ? (dm?.roles ?? []).includes(memberRoleId as string) : false
    const accounts: ReconciledAccount[] = (link.accounts ?? [])
      .map((a) => a.account_name)
      .filter((n): n is string => Boolean(n))
      .map((name) => {
        const inGuild = inGameSet.has(lc(name))
        if (inGuild) matchedInGame.add(lc(name))
        return {
          account_name: name,
          characters: link.accounts?.find((a) => a.account_name === name)?.characters ?? [],
          inGuild
        }
      })
    const guildLabels = [
      ...new Set((link.accounts ?? []).flatMap((a) => Object.values(a.guild_labels ?? {})))
    ]
    const linkedFlag = accounts.length > 0
    const inGuild = accounts.some((a) => a.inGuild)
    const ann = annByMember.get(link.member_id) ?? emptyAnn(link.member_id)

    let status: RosterStatus
    if (!linkedFlag) status = 'no-key'
    else if (!haveInGame) status = 'linked'
    else if (inGuild) status = 'verified'
    else status = 'left-guild'

    const discordName = dm?.name ?? link.member_name
    const label = ann.nickname || dm?.display_name || discordName || accounts[0]?.account_name || link.member_id
    out.push({
      memberId: link.member_id,
      discordName,
      displayName: dm?.display_name,
      hasMemberRole,
      accounts,
      guildLabels,
      linked: linkedFlag,
      inGuild,
      status,
      nickname: ann.nickname,
      aliases: ann.aliases,
      notes: ann.notes,
      tags: ann.tags,
      label
    })
  }

  // 2. Discord members who carry the configured guild-member role but never linked a
  //    key — the "ask them to link" group (only when a role is configured).
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

  // 3. In-game accounts with no Discord match — present in the guild, untied to a member.
  if (haveInGame) {
    for (const name of inGameAccounts) {
      if (matchedInGame.has(lc(name))) continue
      out.push({
        memberId: null,
        hasMemberRole: false,
        accounts: [{ account_name: name, characters: [], inGuild: true }],
        guildLabels: [],
        linked: false,
        inGuild: true,
        status: 'in-game-only',
        nickname: '',
        aliases: [],
        notes: '',
        tags: [],
        label: name
      })
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label))
}
