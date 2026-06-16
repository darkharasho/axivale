import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RendererReconciledMember, RosterStatus } from '../../../../preload/index.d'
import { errText, isOffline } from './shared'

export interface RosterDraft {
  nickname: string
  aliases: string[]
  notes: string
  tags: string[]
}
const EMPTY: RosterDraft = { nickname: '', aliases: [], notes: '', tags: [] }

export type RosterFilter = 'all' | 'no-key' | 'mismatch' | 'annotated'

/** Per-status display: rail LED tone + short labels for the row sub-line and badge. */
export const STATUS_META: Record<RosterStatus, { led: 'g' | 'a' | 'r'; sub: string; badge: string }> =
  {
    verified: { led: 'g', sub: 'verified', badge: 'In-game guild ✓' },
    linked: { led: 'g', sub: 'linked', badge: 'GW2 key linked' },
    'no-key': { led: 'a', sub: 'no key linked', badge: 'No GW2 key' },
    'left-guild': { led: 'r', sub: 'not in guild', badge: 'Not in in-game guild' },
    'in-game-only': { led: 'r', sub: 'no Discord match', badge: 'In-game, no Discord' }
  }

/** Stable selection key — Discord member id, or the account name for an
 *  in-game-only row that has no Discord match. */
export function rosterKey(m: RendererReconciledMember): string {
  return m.memberId ?? `acct:${m.accounts[0]?.account_name ?? '?'}`
}

function annotated(m: RendererReconciledMember): boolean {
  return Boolean(m.nickname || m.aliases.length || m.notes || m.tags.length)
}

function matchesFilter(m: RendererReconciledMember, f: RosterFilter): boolean {
  if (f === 'all') return true
  if (f === 'no-key') return m.status === 'no-key'
  if (f === 'mismatch') return m.status === 'left-guild' || m.status === 'in-game-only'
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
      'in-game-only': 0
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
    save
  }
}
