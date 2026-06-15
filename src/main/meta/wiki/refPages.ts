// src/main/meta/wiki/refPages.ts
//
// Curated GW2-wiki pages to ingest into the reference corpus. Skills/traits use the
// wiki's aggregate "List of <profession> ..." pages (every skill/trait grouped by
// profession in one rich doc) for far better recall than per-entity micro-chunks.
// A title that 404s on the wiki is skipped at ingest time (not fatal), so approximate
// titles are safe to keep — refine against the live wiki as needed.
export interface WikiRefPage {
  category: string
  title: string
}

const PROFESSIONS = [
  'elementalist', 'warrior', 'guardian', 'revenant', 'engineer',
  'ranger', 'thief', 'mesmer', 'necromancer'
]

// Individual elite-specialization pages (HoT / PoF / EoD, 3 per profession). The
// base profession pages + the "Elite specialization" concept page don't describe a
// given spec's mechanics, so these add the spec-level grounding builds rely on.
const ELITE_SPECS = [
  'Tempest', 'Weaver', 'Catalyst', // elementalist
  'Berserker', 'Spellbreaker', 'Bladesworn', // warrior
  'Dragonhunter', 'Firebrand', 'Willbender', // guardian
  'Herald', 'Renegade', 'Vindicator', // revenant
  'Scrapper', 'Holosmith', 'Mechanist', // engineer
  'Druid', 'Soulbeast', 'Untamed', // ranger
  'Daredevil', 'Deadeye', 'Specter', // thief
  'Chronomancer', 'Mirage', 'Virtuoso', // mesmer
  'Reaper', 'Scourge', 'Harbinger' // necromancer
]

export const WIKI_REF_PAGES: WikiRefPage[] = [
  ...PROFESSIONS.map((p) => ({ category: 'skills', title: `List of ${p} skills` })),
  ...PROFESSIONS.map((p) => ({ category: 'traits', title: `List of ${p} traits` })),

  { category: 'upgrades', title: 'Rune' },
  { category: 'upgrades', title: 'Sigil' },
  { category: 'upgrades', title: 'Relic' },
  { category: 'upgrades', title: 'Infusion' },
  { category: 'upgrades', title: 'Upgrade component' },

  { category: 'classes', title: 'Profession' },
  { category: 'classes', title: 'Elementalist' },
  { category: 'classes', title: 'Warrior' },
  { category: 'classes', title: 'Guardian' },
  { category: 'classes', title: 'Revenant' },
  { category: 'classes', title: 'Engineer' },
  { category: 'classes', title: 'Ranger' },
  { category: 'classes', title: 'Thief' },
  { category: 'classes', title: 'Mesmer' },
  { category: 'classes', title: 'Necromancer' },

  { category: 'specializations', title: 'Specialization' },
  { category: 'specializations', title: 'Elite specialization' },
  ...ELITE_SPECS.map((s) => ({ category: 'elite-specs', title: s })),

  { category: 'stats', title: 'Attribute' },
  { category: 'stats', title: 'Power' },
  { category: 'stats', title: 'Precision' },
  { category: 'stats', title: 'Toughness' },
  { category: 'stats', title: 'Vitality' },
  { category: 'stats', title: 'Ferocity' },
  { category: 'stats', title: 'Condition Damage' },
  { category: 'stats', title: 'Expertise' },
  { category: 'stats', title: 'Concentration' },
  { category: 'stats', title: 'Healing Power' },
  { category: 'stats', title: 'Agony Resistance' },
  { category: 'stats', title: 'Attribute combinations' },

  { category: 'armor', title: 'Armor' },
  { category: 'armor', title: 'Armor class' },
  { category: 'armor', title: 'Insignia' },

  { category: 'weapons', title: 'Weapon' },
  { category: 'weapons', title: 'Weapon types' },

  { category: 'boons-conditions', title: 'Boon' },
  { category: 'boons-conditions', title: 'Condition' },
  { category: 'boons-conditions', title: 'Effect' },
  // All 12 boons
  { category: 'boons-conditions', title: 'Aegis' },
  { category: 'boons-conditions', title: 'Alacrity' },
  { category: 'boons-conditions', title: 'Fury' },
  { category: 'boons-conditions', title: 'Might' },
  { category: 'boons-conditions', title: 'Protection' },
  { category: 'boons-conditions', title: 'Quickness' },
  { category: 'boons-conditions', title: 'Regeneration' },
  { category: 'boons-conditions', title: 'Resistance' },
  { category: 'boons-conditions', title: 'Resolution' },
  { category: 'boons-conditions', title: 'Stability' },
  { category: 'boons-conditions', title: 'Swiftness' },
  { category: 'boons-conditions', title: 'Vigor' },
  // All conditions
  { category: 'boons-conditions', title: 'Bleeding' },
  { category: 'boons-conditions', title: 'Blinded' },
  { category: 'boons-conditions', title: 'Burning' },
  { category: 'boons-conditions', title: 'Chilled' },
  { category: 'boons-conditions', title: 'Confusion' },
  { category: 'boons-conditions', title: 'Crippled' },
  { category: 'boons-conditions', title: 'Fear' },
  { category: 'boons-conditions', title: 'Immobile' },
  { category: 'boons-conditions', title: 'Poison' },
  { category: 'boons-conditions', title: 'Slow' },
  { category: 'boons-conditions', title: 'Taunt' },
  { category: 'boons-conditions', title: 'Torment' },
  { category: 'boons-conditions', title: 'Vulnerability' },
  { category: 'boons-conditions', title: 'Weakness' },

  { category: 'mechanics', title: 'Combo' },
  { category: 'mechanics', title: 'Defiance bar' },
  { category: 'mechanics', title: 'Crowd control' },
  { category: 'mechanics', title: 'Downed state' },
  { category: 'mechanics', title: 'Game mechanics' }
]
