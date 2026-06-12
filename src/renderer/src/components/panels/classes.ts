/**
 * GW2 professions and their elite specializations, mirroring axitools'
 * constants.py (the bot's canonical list). Used for the build class picker.
 */
export const PROFESSIONS: Record<string, string[]> = {
  Elementalist: ['Tempest', 'Weaver', 'Catalyst', 'Evoker'],
  Engineer: ['Scrapper', 'Holosmith', 'Mechanist', 'Amalgam'],
  Guardian: ['Dragonhunter', 'Firebrand', 'Willbender', 'Luminary'],
  Mesmer: ['Chronomancer', 'Mirage', 'Virtuoso', 'Troubadour'],
  Necromancer: ['Reaper', 'Scourge', 'Harbinger', 'Ritualist'],
  Ranger: ['Druid', 'Soulbeast', 'Untamed', 'Galeshot'],
  Revenant: ['Herald', 'Renegade', 'Vindicator', 'Conduit'],
  Thief: ['Daredevil', 'Deadeye', 'Specter', 'Antiquary'],
  Warrior: ['Berserker', 'Spellbreaker', 'Bladesworn', 'Paragon']
}

/** Spec name → its base profession (for deriving profession from a spec pick). */
export const SPEC_TO_PROFESSION: Record<string, string> = Object.fromEntries(
  Object.entries(PROFESSIONS).flatMap(([prof, specs]) => specs.map((s) => [s, prof]))
)

export interface ClassOption {
  value: string // the spec or profession name stored as the build's class
  label: string
  profession: string
  isCore: boolean
}

/** Flat option list, professions each followed by their specs, for a grouped select. */
export const CLASS_OPTIONS: ClassOption[] = Object.entries(PROFESSIONS).flatMap(
  ([prof, specs]) => [
    { value: prof, label: `${prof} (core)`, profession: prof, isCore: true },
    ...specs.map((s) => ({ value: s, label: s, profession: prof, isCore: false }))
  ]
)

/** Split a stored class value into {profession, specialization}. */
export function splitClass(value: string): { profession: string; specialization?: string } {
  if (PROFESSIONS[value]) return { profession: value }
  const prof = SPEC_TO_PROFESSION[value]
  if (prof) return { profession: prof, specialization: value }
  return { profession: value } // unknown — treat as a bare profession label
}
