// Gear-extraction cases. Profession is '' so no profession/skills API calls are made
// (resolveWeaponSkills returns [] for an empty profession) — keeps the fixture small.
export interface GearCase {
  id: string
  profession: string
  expect: {
    stats?: RegExp
    runeCount?: number
    runeName?: RegExp
    weapons?: number
    sigils?: number
    infusions?: number
  }
}

export const gearCases: GearCase[] = [
  {
    id: 'mb-minstrel-guardian',
    profession: '',
    expect: {
      stats: /Minstrel/,
      runeCount: 6,
      runeName: /Rune/,
      weapons: 3, // Staff + Mace + Shield
      sigils: 3,
      infusions: 1
    }
  }
]
