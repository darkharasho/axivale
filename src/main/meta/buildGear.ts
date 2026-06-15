// src/main/meta/buildGear.ts
//
// Scrape a meta build page's GW2-Armory embeds into structured equipment, so the
// build card can show weapons+sigils, armor stats+runes, and trinkets+infusions
// that an in-game build-template chat code does NOT carry. Reuses parseArmory
// (the same embeds Snowcrows/MetaBattle render); resolves item/stat details via
// the public GW2 API. Network failures degrade to null (card stays sparse).
import { parseArmory, type FetchLike } from './snowcrows'

export interface GearWeapon {
  type: string // e.g. "Greatsword"
  name: string
  icon: string | null
  sigils: Array<{ name: string; icon: string | null }>
}

/** GW2 weapon types, used to tell a weapon slot from an armor/trinket one by its label. */
const WEAPON_TYPES = new Set([
  'Axe', 'Dagger', 'Mace', 'Pistol', 'Scepter', 'Sword', 'Focus', 'Shield', 'Torch', 'Warhorn',
  'Greatsword', 'Hammer', 'Longbow', 'Shortbow', 'Rifle', 'Staff',
  'Spear', 'Speargun', 'Harpoon', 'Trident'
])
/** Two-handed weapons carry two sigils; everything else carries one. */
const TWO_HANDED = new Set(['Greatsword', 'Hammer', 'Longbow', 'Shortbow', 'Rifle', 'Staff', 'Speargun', 'Trident'])

export type MetabattleSlotKind = 'weapon' | 'sigil' | 'rune' | 'infusion' | 'relic' | 'gear'
export interface MetabattleSlot {
  id: number
  kind: MetabattleSlotKind
  type: string // weapon type, or the slot/upgrade label (Head, Sigil, Rune, ...)
  stat: string | null // stat prefix from the label (e.g. "Minstrel"), when present
  statId: number | null // inline data-armory-<id>-stat, when present
  count: number // upgrade count from the label (Rune x6 -> 6); 1 otherwise
}

/**
 * Parse a MetaBattle build page's Equipment section into ordered slots. Unlike
 * Snowcrows, MetaBattle renders each piece (and each rune/sigil) as its own
 * equipment-slot armory embed with a <small> label, and does NOT inline upgrades.
 * Returns [] for pages that don't use this layout (e.g. Snowcrows). Order matters:
 * sigils follow their weapon set, which assembleMetabattleGear relies on.
 */
export function parseMetabattleSlots(html: string): MetabattleSlot[] {
  const slots: MetabattleSlot[] = []
  const slotRe =
    /<div class="equipment-slot[^"]*">\s*<div\b([^>]*\bdata-armory-embed="items"[^>]*)><\/div>\s*<small>(.*?)<\/small>/gi
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(html)) !== null) {
    const attrs = m[1]
    const id = parseInt(/\bdata-armory-ids="(\d+)"/i.exec(attrs)?.[1] ?? '', 10)
    if (!Number.isFinite(id)) continue
    const statRaw = new RegExp(`\\bdata-armory-${id}-stat="(\\d+)"`, 'i').exec(attrs)?.[1]
    const statId = statRaw ? parseInt(statRaw, 10) : null
    // Label is "Type<br />Extra": Extra is a stat prefix (Minstrel) or a count (x6).
    const [typeRaw, extraRaw = ''] = m[2].split(/<br\s*\/?>/i)
    const type = typeRaw.replace(/<[^>]+>/g, '').trim()
    const extra = extraRaw.replace(/<[^>]+>/g, '').trim()
    const countMatch = /^x(\d+)$/i.exec(extra)
    const count = countMatch ? parseInt(countMatch[1], 10) : 1
    let kind: MetabattleSlotKind
    if (WEAPON_TYPES.has(type)) kind = 'weapon'
    else if (type === 'Sigil') kind = 'sigil'
    else if (type === 'Rune') kind = 'rune'
    else if (type === 'Infusion') kind = 'infusion'
    else if (type === 'Relic') kind = 'relic'
    else kind = 'gear'
    const stat = kind === 'gear' || kind === 'weapon' ? extra || null : null
    slots.push({ id, kind, type, stat, statId, count })
  }
  return slots
}
export interface BuildGear {
  weapons: GearWeapon[]
  rune: { name: string; icon: string | null; count: number } | null
  sigils: Array<{ name: string; icon: string | null }>
  stats: string | null
  infusions: Array<{ name: string; icon: string | null }>
  /** First weapon set's 5 skills (id/name/icon), derived from the scraped weapons. */
  weaponSkills: Array<{ id: number; name: string; icon: string | null }>
}

/** The 5 weapon skills (slots 1-5) for a profession's first weapon set. */
async function resolveWeaponSkills(
  profession: string,
  weaponTypes: string[],
  fetchImpl: FetchLike
): Promise<Array<{ id: number; name: string; icon: string | null }>> {
  const types = weaponTypes.filter(Boolean)
  if (!profession || types.length === 0) return []
  const slotNum: Record<string, number> = { Weapon_1: 1, Weapon_2: 2, Weapon_3: 3, Weapon_4: 4, Weapon_5: 5 }
  try {
    const res = await fetchImpl(`https://api.guildwars2.com/v2/professions/${encodeURIComponent(profession)}?v=latest`)
    if (!res.ok) return []
    const prof = (await res.json()) as { weapons?: Record<string, { skills?: Array<{ id: number; slot: string }> }> }
    const bySlot: Record<number, number> = {}
    for (const wt of types) {
      for (const sk of prof.weapons?.[wt]?.skills ?? []) {
        const n = slotNum[sk.slot]
        if (n && !bySlot[n]) bySlot[n] = sk.id
      }
    }
    const ids = [1, 2, 3, 4, 5].map((n) => bySlot[n]).filter(Boolean)
    if (!ids.length) return []
    const r = await fetchImpl(`https://api.guildwars2.com/v2/skills?ids=${ids.join(',')}&lang=en`)
    if (!r.ok) return []
    const skills = (await r.json()) as Array<{ id: number; name: string; icon?: string }>
    const byId = new Map(skills.map((s) => [s.id, { id: s.id, name: s.name, icon: s.icon ?? null }]))
    return ids.map((id) => byId.get(id)).filter((s): s is { id: number; name: string; icon: string | null } => !!s)
  } catch {
    return []
  }
}

interface ItemDef {
  name: string
  icon: string | null
  type: string // Weapon | Armor | Trinket | Back | UpgradeComponent | ...
  subType: string | null // weapon type, or Rune/Sigil for upgrades
}

const UA = 'AxiVale/0.4 (https://github.com/darkharasho)'
const defaultFetch: FetchLike = (url) => fetch(url, { headers: { 'User-Agent': UA } })

async function resolveItems(ids: number[], fetchImpl: FetchLike): Promise<Map<number, ItemDef>> {
  const map = new Map<number, ItemDef>()
  const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))]
  for (let i = 0; i < unique.length; i += 150) {
    try {
      const res = await fetchImpl(`https://api.guildwars2.com/v2/items?ids=${unique.slice(i, i + 150).join(',')}&lang=en`)
      if (!res.ok) continue
      const arr = (await res.json()) as Array<{ id: number; name: string; icon?: string; type: string; details?: { type?: string } }>
      for (const it of arr) map.set(it.id, { name: it.name, icon: it.icon ?? null, type: it.type, subType: it.details?.type ?? null })
    } catch {
      /* skip a failed chunk */
    }
  }
  return map
}

async function resolveStats(ids: number[], fetchImpl: FetchLike): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))]
  if (!unique.length) return map
  try {
    const res = await fetchImpl(`https://api.guildwars2.com/v2/itemstats?ids=${unique.join(',')}&lang=en`)
    if (res.ok) for (const s of (await res.json()) as Array<{ id: number; name: string }>) map.set(s.id, s.name)
  } catch {
    /* leave empty */
  }
  return map
}

/** Parse a build page's armory embeds into structured equipment, or null.
 *  Pass the profession to also resolve the first weapon set's skills. */
/**
 * Assemble gear from MetaBattle's ordered, slot-labeled embeds. Sigils follow their
 * weapon SET in document order, so we group consecutive weapons and hand the trailing
 * sigils out by capacity (a 2H weapon takes two; each 1H weapon takes one).
 */
async function assembleMetabattleGear(
  slots: MetabattleSlot[],
  profession: string,
  fetchImpl: FetchLike
): Promise<BuildGear | null> {
  const itemMap = await resolveItems(
    slots.map((s) => s.id),
    fetchImpl
  )
  const statMap = await resolveStats(
    slots.map((s) => s.statId).filter((n): n is number => n != null),
    fetchImpl
  )
  const nameIcon = (id: number): { name: string; icon: string | null } | null => {
    const def = itemMap.get(id)
    return def ? { name: def.name, icon: def.icon } : null
  }

  const weapons: GearWeapon[] = []
  const allSigils: Array<{ name: string; icon: string | null }> = []
  const infusions: Array<{ name: string; icon: string | null }> = []
  const runeCounts = new Map<string, { icon: string | null; count: number }>()

  // Dominant stat prefix across every piece that carries one (armor, trinkets, weapons).
  const statCounts = new Map<string, number>()
  for (const s of slots) {
    const stat = s.statId != null ? statMap.get(s.statId) : undefined
    if (stat) statCounts.set(stat, (statCounts.get(stat) ?? 0) + 1)
  }

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.kind === 'weapon') {
      // Collect this consecutive run of weapons, then the sigils that follow the set.
      const group: MetabattleSlot[] = []
      while (i < slots.length && slots[i].kind === 'weapon') {
        group.push(slots[i])
        i++
      }
      const setSigils: typeof allSigils = []
      while (i < slots.length && slots[i].kind === 'sigil') {
        const ni = nameIcon(slots[i].id)
        if (ni) setSigils.push(ni)
        i++
      }
      i-- // step back so the for-loop's i++ lands on the next unconsumed slot
      allSigils.push(...setSigils)
      let cursor = 0
      for (const w of group) {
        const cap = TWO_HANDED.has(w.type) ? 2 : 1
        const def = itemMap.get(w.id)
        weapons.push({
          type: w.type,
          name: def?.name ?? w.type,
          icon: def?.icon ?? null,
          sigils: setSigils.slice(cursor, cursor + cap)
        })
        cursor += cap
      }
    } else if (s.kind === 'rune') {
      const def = itemMap.get(s.id)
      if (def) runeCounts.set(def.name, { icon: def.icon, count: s.count })
    } else if (s.kind === 'infusion') {
      const ni = nameIcon(s.id)
      if (ni) infusions.push(ni)
    }
    // 'gear' (armor/trinket) contributes only its stat (handled above); 'relic' and
    // stray 'sigil' slots are not rendered by the card, so they're skipped here.
  }

  const dominant = <T>(m: Map<T, number>): T | null =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const runeName = dominant(new Map([...runeCounts].map(([n, v]) => [n, v.count])))
  const rune = runeName
    ? { name: runeName, icon: runeCounts.get(runeName)!.icon, count: runeCounts.get(runeName)!.count }
    : null

  if (weapons.length === 0 && !rune && statCounts.size === 0) return null
  const firstSet = weapons.slice(0, 2).map((w) => w.type)
  const weaponSkills = await resolveWeaponSkills(profession, firstSet, fetchImpl)
  return { weapons, rune, sigils: allSigils, stats: dominant(statCounts), infusions, weaponSkills }
}

export async function scrapeBuildGear(
  html: string,
  profession = '',
  fetchImpl: FetchLike = defaultFetch
): Promise<BuildGear | null> {
  // MetaBattle lists each piece (and each rune/sigil) as its own labeled slot and
  // does NOT inline upgrades, so it needs an order-aware assembler.
  const mbSlots = parseMetabattleSlots(html)
  if (mbSlots.length) return assembleMetabattleGear(mbSlots, profession, fetchImpl)

  const { items } = parseArmory(html)
  if (items.length === 0) return null
  const allIds = [...items.map((i) => i.id), ...items.flatMap((i) => i.upgradeIds)]
  const [itemMap, statMap] = await Promise.all([
    resolveItems(allIds, fetchImpl),
    resolveStats(
      items.map((i) => i.statId).filter((n): n is number => n != null),
      fetchImpl
    )
  ])

  const weapons: GearWeapon[] = []
  const allSigils: Array<{ name: string; icon: string | null }> = []
  const infusions: Array<{ name: string; icon: string | null }> = []
  const runeCounts = new Map<string, { icon: string | null; count: number }>()
  const statCounts = new Map<string, number>()
  const up = (id: number): ItemDef | undefined => itemMap.get(id)

  for (const it of items) {
    const def = itemMap.get(it.id)
    if (!def) continue
    if (it.statId != null) {
      const stat = statMap.get(it.statId)
      if (stat) statCounts.set(stat, (statCounts.get(stat) ?? 0) + 1)
    }
    const upgrades = it.upgradeIds.map(up).filter((d): d is ItemDef => !!d)
    if (def.type === 'Weapon') {
      const sigils = upgrades.filter((u) => u.subType === 'Sigil').map((u) => ({ name: u.name, icon: u.icon }))
      allSigils.push(...sigils)
      weapons.push({ type: def.subType ?? def.name, name: def.name, icon: def.icon, sigils })
    } else if (def.type === 'Armor') {
      for (const u of upgrades.filter((u) => u.subType === 'Rune')) {
        const prev = runeCounts.get(u.name) ?? { icon: u.icon, count: 0 }
        runeCounts.set(u.name, { icon: u.icon, count: prev.count + 1 })
      }
    } else if (def.type === 'Trinket' || def.type === 'Back') {
      for (const u of upgrades.filter((u) => u.type === 'UpgradeComponent' && u.subType !== 'Rune' && u.subType !== 'Sigil')) {
        infusions.push({ name: u.name, icon: u.icon })
      }
    }
  }

  const dominant = <T>(m: Map<T, number>): T | null =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const runeName = dominant(new Map([...runeCounts].map(([n, v]) => [n, v.count])))
  const rune = runeName ? { name: runeName, icon: runeCounts.get(runeName)!.icon, count: runeCounts.get(runeName)!.count } : null

  if (weapons.length === 0 && !rune && statCounts.size === 0) return null
  // First weapon set = first 1-2 weapons; resolve their skills for the card's top row.
  const firstSet = weapons.slice(0, 2).map((w) => w.type)
  const weaponSkills = await resolveWeaponSkills(profession, firstSet, fetchImpl)
  return { weapons, rune, sigils: allSigils, stats: dominant(statCounts), infusions, weaponSkills }
}
