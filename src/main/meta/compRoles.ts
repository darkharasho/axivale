// src/main/meta/compRoles.ts
//
// Sourced WvW role → boon/duty mapping used by comp_check to translate a build's
// squad role into the coverage it provides. Derived from the Snowcrows "WvW
// Basics: Understanding Roles" guide; every entry traces to a source URL. This is
// a small curated lookup, NOT model output — update it when the guide changes.

const SC_ROLES = 'https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles'

export type WvwRole =
  | 'Primary Support'
  | 'Secondary Support'
  | 'Tertiary Support'
  | 'Boon Strip DPS'
  | 'Pure DPS'

export interface RoleDef {
  role: WvwRole
  /** Boons/effects this role provides to allies. */
  boons: string[]
  /** Non-boon duties (heal, cleanse, barrier, CC). */
  duties: string[]
  /** True if the role's job is removing ENEMY boons (provides little to allies). */
  strips: boolean
  source: string
}

export const WVW_ROLES: RoleDef[] = [
  {
    role: 'Primary Support',
    boons: ['Stability', 'Resistance', 'Protection', 'Might'],
    duties: ['Maintain subgroup stability', 'Monitor boon bar'],
    strips: false,
    source: SC_ROLES
  },
  {
    role: 'Secondary Support',
    // Sustain role per the SC guide (heal/cleanse/barrier) — not a boon provider; keep boons empty.
    boons: [],
    duties: ['Healing', 'Condition Removal', 'Barrier'],
    strips: false,
    source: SC_ROLES
  },
  {
    role: 'Tertiary Support',
    boons: ['Quickness', 'Might', 'Resistance'],
    duties: ['Flex utility', 'Down resurrection'],
    strips: false,
    source: SC_ROLES
  },
  {
    role: 'Boon Strip DPS',
    boons: [],
    duties: ['Enemy boon removal', 'Crowd control'],
    strips: true,
    source: SC_ROLES
  },
  {
    role: 'Pure DPS',
    boons: [],
    duties: ['Burst damage', 'Cleave downs'],
    strips: false,
    source: SC_ROLES
  }
]

export function boonsForRole(role: WvwRole): string[] {
  return WVW_ROLES.find((r) => r.role === role)?.boons ?? []
}
