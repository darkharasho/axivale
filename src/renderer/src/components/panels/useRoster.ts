import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RendererReconciledMember, RosterStatus } from '../../../../preload/index.d'
import { axi, errText, isOffline, type Overview } from './shared'

export interface RosterDraft {
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
}
const EMPTY: RosterDraft = { nickname: '', aliases: [], notes: '', tags: [] }

export type RosterFilter = 'all' | 'unlinked' | 'no-key' | 'annotated'

/** Per-status display: rail LED tone + short labels for the row sub-line and badge. */
export const STATUS_META: Record<RosterStatus, { led: 'g' | 'a' | 'r'; sub: string; badge: string }> =
  {
    verified: { led: 'g', sub: 'verified', badge: 'In-game guild ✓' },
    linked: { led: 'g', sub: 'linked', badge: 'GW2 key linked' },
    'no-key': { led: 'a', sub: 'no key linked', badge: 'No GW2 key' },
    'left-guild': { led: 'r', sub: 'not in guild', badge: 'Not in in-game guild' },
    unlinked: { led: 'a', sub: 'no Discord match', badge: 'No Discord — link one' }
  }

export interface DiscordMemberLite {
  id: string
  name?: string
  display_name?: string
}

/** Stable selection key — prefer the GW2 account (GW2-first rows keep their key
 *  across linking), else the Discord member id. */
export function rosterKey(m: RendererReconciledMember): string {
  if (m.accountName) return `acct:${m.accountName}`
  return m.memberId ?? '?'
}

function annotated(m: RendererReconciledMember): boolean {
  return Boolean(m.nickname || m.aliases.length || m.notes || m.tags.length)
}

function matchesFilter(m: RendererReconciledMember, f: RosterFilter): boolean {
  if (f === 'all') return true
  if (f === 'unlinked') return m.status === 'unlinked'
  if (f === 'no-key') return m.status === 'no-key'
  return annotated(m)
}

function haystack(m: RendererReconciledMember): string {
  return [
    m.label,
    m.displayName ?? '',
    m.discordName ?? '',
    m.nickname,
    ...m.aliases,
    ...m.accounts.flatMap((a) => [a.account_name, ...a.characters])
  ]
    .join(' ')
    .toLowerCase()
}

export interface RosterController {
  members: RendererReconciledMember[]
  filtered: RendererReconciledMember[]
  loaded: boolean
  busy: boolean
  offline: boolean
  error: string
  query: string
  setQuery: (q: string) => void
  filter: RosterFilter
  setFilter: (f: RosterFilter) => void
  counts: Record<RosterStatus, number>
  selectedKey: string | null
  current: RendererReconciledMember | null
  draft: RosterDraft
  setDraft: (d: RosterDraft) => void
  dirty: boolean
  select: (m: RendererReconciledMember) => void
  refresh: () => Promise<void>
  save: () => Promise<void>
  /** Discord members for the manual-link picker. */
  discordMembers: DiscordMemberLite[]
  link: (accountName: string, memberId: string) => Promise<void>
  unlink: (accountName: string) => Promise<void>
}

export function useRoster(active: boolean): RosterController {
  const [members, setMembers] = useState<RendererReconciledMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<RosterDraft>(EMPTY)
  const [discordMembers, setDiscordMembers] = useState<DiscordMemberLite[]>([])

  const loadDraft = useCallback((m: RendererReconciledMember | null) => {
    setDraft(
      m
        ? { nickname: m.nickname, aliases: [...m.aliases], notes: m.notes, tags: [...m.tags] }
        : EMPTY
    )
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const list = await window.officer.rosterReconcile()
      setMembers(list)
      setOffline(false)
      setError('')
      // Discord member list for the manual-link picker (best-effort overlay).
      try {
        const ov = await axi<Overview>('discordOverview', true)
        setDiscordMembers(
          (ov.members ?? []).map((d) => ({ id: d.id, name: d.name, display_name: d.display_name }))
        )
      } catch {
        /* picker just stays empty */
      }
      // Keep the current selection if it still exists, else pick the first.
      setSelectedKey((prev) => {
        const keep = prev ? list.find((m) => rosterKey(m) === prev) : undefined
        const next = keep ?? list[0] ?? null
        loadDraft(next)
        return next ? rosterKey(next) : null
      })
    } catch (e) {
      if (isOffline(e)) setOffline(true)
      else setError(errText(e))
    } finally {
      setLoaded(true)
      setBusy(false)
    }
  }, [loadDraft])

  // Reconcile lazily — it hits the Discord + GW2 APIs, so only when the tab is
  // first opened (not on every app mount).
  useEffect(() => {
    if (active && !loaded && !busy) void refresh()
  }, [active, loaded, busy, refresh])

  const current = useMemo(
    () => members.find((m) => rosterKey(m) === selectedKey) ?? null,
    [members, selectedKey]
  )

  const dirty = current
    ? draft.nickname !== current.nickname ||
      draft.notes !== current.notes ||
      draft.aliases.join('') !== current.aliases.join('') ||
      draft.tags.join('') !== current.tags.join('')
    : false

  function select(m: RendererReconciledMember): void {
    if (dirty && !window.confirm('Discard unsaved changes to this member?')) return
    setSelectedKey(rosterKey(m))
    loadDraft(m)
  }

  async function save(): Promise<void> {
    if (!current?.memberId) return
    const patch = {
      nickname: draft.nickname.trim(),
      aliases: draft.aliases,
      notes: draft.notes,
      tags: draft.tags
    }
    await window.officer.rosterAnnotationUpsert(current.memberId, patch)
    // Update locally instead of a full network re-reconcile.
    const label = patch.nickname || current.displayName || current.discordName || current.label
    setMembers((prev) =>
      prev.map((m) => (m.memberId === current.memberId ? { ...m, ...patch, label } : m))
    )
  }

  async function link(accountName: string, memberId: string): Promise<void> {
    await window.officer.rosterLinkSet(accountName, memberId)
    await refresh()
  }

  async function unlink(accountName: string): Promise<void> {
    await window.officer.rosterLinkDelete(accountName)
    await refresh()
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) => matchesFilter(m, filter) && (!q || haystack(m).includes(q)))
  }, [members, query, filter])

  const counts = useMemo(() => {
    const c: Record<RosterStatus, number> = {
      verified: 0,
      linked: 0,
      'no-key': 0,
      'left-guild': 0,
      unlinked: 0
    }
    for (const m of members) c[m.status]++
    return c
  }, [members])

  return {
    members,
    filtered,
    loaded,
    busy,
    offline,
    error,
    query,
    setQuery,
    filter,
    setFilter,
    counts,
    selectedKey,
    current,
    draft,
    setDraft,
    dirty,
    select,
    refresh,
    save,
    discordMembers,
    link,
    unlink
  }
}
