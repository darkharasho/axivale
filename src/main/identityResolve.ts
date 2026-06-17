// src/main/identityResolve.ts
//
// Pure ranking for the resolve_identity tool: given a loose name reference
// ("Bob", "@bobby", a display name, an in-game shorthand), score it against the
// linked roster joined with the user's roster annotations, and return the most
// likely members. Kept pure (no IO) so it's unit-testable.

export interface ResolveMemberLite {
  member_id: string
  member_name?: string
  display_name?: string
  accounts?: Array<{ account_name?: string; characters?: string[] }>
}

export interface ResolveAnnotationLite {
  memberId: string
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
}

export interface ManualLinkLite {
  accountName: string
  memberId: string
}

/** Fold user-created manual links into the linked-member list so the agent
 *  resolves manually-linked accounts too: append each link's account to its
 *  member (creating a synthetic member entry when AxiTools never linked them). */
export function mergeManualLinks(
  members: ResolveMemberLite[],
  links: ManualLinkLite[]
): ResolveMemberLite[] {
  const byId = new Map<string, ResolveMemberLite>(
    members.map((m) => [m.member_id, { ...m, accounts: [...(m.accounts ?? [])] }])
  )
  for (const link of links) {
    let m = byId.get(link.memberId)
    if (!m) {
      m = { member_id: link.memberId, accounts: [] }
      byId.set(link.memberId, m)
    }
    const has = (m.accounts ?? []).some(
      (a) => (a.account_name ?? '').toLowerCase() === link.accountName.toLowerCase()
    )
    if (!has) m.accounts = [...(m.accounts ?? []), { account_name: link.accountName }]
  }
  return [...byId.values()]
}

/** A player seen in AxiBridge combat logs, for resolving loose names against
 *  recurring logged players (not just the linked Discord roster). */
export interface LoggedPlayerLite {
  account: string
  runs: number
}

/** Minimum logged runs for a player to be resolvable by name — keeps one-off
 *  pugs out of the identity pool while catching anyone recurring. */
export const MIN_LOGGED_RUNS = 3

/** Synthetic `acct:<name>` members for recurring logged players, so loose names
 *  ("break") resolve to logged accounts ("BreakN.5496") the linked roster lacks.
 *  Skips any account already present among `existing` (linked roster / annotations
 *  win) so the same person never appears twice and trips the ambiguous-tie guard. */
export function loggedPlayerMembers(
  players: LoggedPlayerLite[],
  existing: ResolveMemberLite[],
  minRuns = MIN_LOGGED_RUNS
): ResolveMemberLite[] {
  const have = new Set(
    existing.flatMap((m) =>
      (m.accounts ?? []).map((a) => (a.account_name ?? '').toLowerCase()).filter(Boolean)
    )
  )
  const out: ResolveMemberLite[] = []
  for (const p of players) {
    if (p.runs < minRuns) continue
    const acct = p.account?.trim()
    if (!acct || have.has(acct.toLowerCase())) continue
    have.add(acct.toLowerCase())
    out.push({ member_id: `acct:${acct}`, accounts: [{ account_name: acct }] })
  }
  return out
}

export interface IdentityMatch {
  member_id: string
  member_name?: string
  display_name?: string
  nickname?: string
  aliases?: string[]
  account_names: string[]
  notes?: string
  tags?: string[]
  score: number
  /** Human-readable reasons this member matched, e.g. ["alias:bobby", "nickname:Bob"]. */
  matched_on: string[]
}

const norm = (s: string): string => s.trim().toLowerCase()
/** GW2 accounts carry a discriminator ("Logan.1234"); the part before it is what
 *  people actually type. */
const localPart = (account: string): string => account.split('.')[0] ?? account
/** Strip digits and punctuation from a Discord-style name, drop 1-char tokens, and
 *  lower-case — so ".harasho" -> "harasho", "Bob_99" -> "bob". '' if nothing useful. */
export const cleanName = (s: string): string =>
  s
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .join(' ')
    .trim()
    .toLowerCase()

interface Field {
  kind: string
  value: string
  weight: number
  /** Also match the query against the account's local part (pre-discriminator). */
  account?: boolean
}

/** Score one candidate value against the query (raw + cleaned). Higher = closer.
 *  Candidates include the raw value, the account local part, and the cleaned name
 *  (digits/punctuation stripped), each matched against the raw and cleaned query. */
function scoreValue(q: string, qc: string, f: Field): number {
  const v = norm(f.value)
  if (!v) return 0
  const candidates = new Set([v])
  if (f.account) candidates.add(norm(localPart(f.value)))
  else {
    const c = cleanName(f.value)
    if (c) candidates.add(c)
  }
  const queries = qc && qc !== q ? [q, qc] : [q]
  let best = 0
  for (const c of candidates) {
    if (!c) continue
    for (const query of queries) {
      if (c === query) best = Math.max(best, f.weight * 3)
      else if (c.startsWith(query) || query.startsWith(c)) best = Math.max(best, f.weight * 2)
      else if (query.length >= 2 && c.includes(query)) best = Math.max(best, f.weight)
    }
  }
  return best
}

export function rankIdentities(
  rawQuery: string,
  members: ResolveMemberLite[],
  annotations: ResolveAnnotationLite[],
  limit = 8
): IdentityMatch[] {
  // Strip a leading Discord mention "@" so "@bob" matches "bob".
  const q = norm(rawQuery.replace(/^@+/, ''))
  if (!q) return []
  const qc = cleanName(q)

  const annByMember = new Map(annotations.map((a) => [a.memberId, a]))
  const matches: IdentityMatch[] = []

  for (const m of members) {
    const ann = annByMember.get(m.member_id)
    const accountNames = (m.accounts ?? [])
      .map((a) => a.account_name)
      .filter((x): x is string => Boolean(x))
    const characters = (m.accounts ?? []).flatMap((a) => a.characters ?? [])

    const fields: Field[] = []
    if (ann?.nickname) fields.push({ kind: 'nickname', value: ann.nickname, weight: 6 })
    for (const a of ann?.aliases ?? []) fields.push({ kind: 'alias', value: a, weight: 6 })
    if (m.display_name) fields.push({ kind: 'display', value: m.display_name, weight: 4 })
    if (m.member_name) fields.push({ kind: 'member', value: m.member_name, weight: 4 })
    for (const a of accountNames) fields.push({ kind: 'account', value: a, weight: 4, account: true })
    for (const c of characters) fields.push({ kind: 'character', value: c, weight: 3 })
    for (const t of ann?.tags ?? []) fields.push({ kind: 'tag', value: t, weight: 2 })
    if (ann?.notes) fields.push({ kind: 'notes', value: ann.notes, weight: 1 })

    let score = 0
    const matched_on: string[] = []
    for (const f of fields) {
      const s = scoreValue(q, qc, f)
      if (s > 0) {
        score += s
        matched_on.push(`${f.kind}:${f.value}`)
      }
    }
    if (score <= 0) continue

    matches.push({
      member_id: m.member_id,
      member_name: m.member_name,
      display_name: m.display_name,
      nickname: ann?.nickname || undefined,
      aliases: ann?.aliases?.length ? ann.aliases : undefined,
      account_names: accountNames,
      notes: ann?.notes || undefined,
      tags: ann?.tags?.length ? ann.tags : undefined,
      score,
      matched_on
    })
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit)
}
