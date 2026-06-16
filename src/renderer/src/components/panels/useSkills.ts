import { useEffect, useMemo, useState } from 'react'
import type { RendererSkill } from '../../../../preload/index.d'

export interface SkillDraft {
  name: string
  whenToUse: string
  instructions: string
}
const EMPTY: SkillDraft = { name: '', whenToUse: '', instructions: '' }

export interface SkillsController {
  skills: RendererSkill[]
  activeId: string | null
  creating: boolean
  current: RendererSkill | null
  draft: SkillDraft
  setDraft: (d: SkillDraft) => void
  dirty: boolean
  valid: boolean
  tab: 'edit' | 'preview'
  setTab: (t: 'edit' | 'preview') => void
  query: string
  setQuery: (q: string) => void
  filtered: RendererSkill[]
  select: (s: RendererSkill) => void
  newSkill: () => void
  save: () => Promise<void>
  toggle: (s: RendererSkill) => Promise<void>
  remove: (s: RendererSkill) => Promise<void>
}

/** Shared skills state for the left-rail list + the detail editor (lifted to App,
 *  mirroring how Meta splits MetaNav + the Meta pane over one source of truth). */
export function useSkills(): SkillsController {
  const [skills, setSkills] = useState<RendererSkill[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<SkillDraft>(EMPTY)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [query, setQuery] = useState('')

  function loadDraft(s: RendererSkill | null): void {
    setDraft(s ? { name: s.name, whenToUse: s.whenToUse, instructions: s.instructions } : EMPTY)
  }

  function selectFrom(list: RendererSkill[], id: string | null): void {
    const s = id ? (list.find((x) => x.id === id) ?? null) : null
    setCreating(false)
    setActiveId(s?.id ?? null)
    loadDraft(s)
  }

  // Initial load: open the first skill so the page is never blank.
  useEffect(() => {
    void window.officer.skillsList().then((list) => {
      setSkills(list)
      selectFrom(list, list[0]?.id ?? null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh(select?: string | null): Promise<void> {
    const list = await window.officer.skillsList()
    setSkills(list)
    if (select !== undefined) selectFrom(list, select)
  }

  const current = useMemo(
    () => (activeId ? (skills.find((s) => s.id === activeId) ?? null) : null),
    [skills, activeId]
  )

  const dirty = creating
    ? Boolean(draft.name.trim() || draft.whenToUse.trim() || draft.instructions.trim())
    : current
      ? draft.name !== current.name ||
        draft.whenToUse !== current.whenToUse ||
        draft.instructions !== current.instructions
      : false

  const valid =
    draft.name.trim().length > 0 &&
    draft.whenToUse.trim().length > 0 &&
    draft.instructions.trim().length > 0

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('Discard unsaved changes to this skill?')
  }

  function select(s: RendererSkill): void {
    if (s.id === activeId && !creating) return
    if (!confirmDiscard()) return
    setCreating(false)
    setActiveId(s.id)
    loadDraft(s)
    setTab('edit')
  }

  function newSkill(): void {
    if (!confirmDiscard()) return
    setCreating(true)
    setActiveId(null)
    setDraft(EMPTY)
    setTab('edit')
  }

  async function save(): Promise<void> {
    if (!valid) return
    const fields = {
      name: draft.name.trim(),
      whenToUse: draft.whenToUse.trim(),
      instructions: draft.instructions.trim()
    }
    if (creating) {
      const made = await window.officer.skillsCreate(fields)
      await refresh(made.id)
    } else if (activeId) {
      await window.officer.skillsUpdate(activeId, fields)
      await refresh(activeId)
    }
  }

  async function toggle(s: RendererSkill): Promise<void> {
    await window.officer.skillsUpdate(s.id, { enabled: !s.enabled })
    await refresh()
  }

  async function remove(s: RendererSkill): Promise<void> {
    if (!window.confirm(`Delete the "${s.name}" skill?`)) return
    await window.officer.skillsDelete(s.id)
    // reload so selection lands on a surviving skill (or the new-skill blank)
    const fresh = await window.officer.skillsList()
    setSkills(fresh)
    selectFrom(fresh, fresh[0]?.id ?? null)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.whenToUse.toLowerCase().includes(q)
    )
  }, [skills, query])

  return {
    skills,
    activeId,
    creating,
    current,
    draft,
    setDraft,
    dirty,
    valid,
    tab,
    setTab,
    query,
    setQuery,
    filtered,
    select,
    newSkill,
    save,
    toggle,
    remove
  }
}
