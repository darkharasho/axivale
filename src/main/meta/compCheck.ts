// src/main/meta/compCheck.ts
//
// Deterministic WvW comp coverage validator. Given a roster (builds grouped into
// subgroups, each build tagged with a WvW role), it checks per-subgroup boon
// coverage and squad-wide role presence against the sourced role mapping, and
// returns structured findings. Pure — no I/O. The model proposes a roster, calls
// this, and fixes the findings.

import { WVW_ROLES, type WvwRole } from './compRoles'

export interface RosterEntry {
  build: string
  role: string
}
export interface Roster {
  subgroups: RosterEntry[][]
}

export type Severity = 'error' | 'warning'
export interface Finding {
  severity: Severity
  message: string
  /** 0-based subgroup index, or null for squad-wide findings. */
  subgroup: number | null
}
export interface CompReport {
  findings: Finding[]
  /** GW2 Wiki: boons affect at most 5 targets — the reason subgroups cap at 5. */
  boonCap: number
}

const KNOWN_ROLES = new Set<string>(WVW_ROLES.map((r) => r.role))
const isRole = (s: string): s is WvwRole => KNOWN_ROLES.has(s)

export function checkComp(roster: Roster): CompReport {
  const findings: Finding[] = []
  if (roster.subgroups.length === 0) {
    return { findings: [{ severity: 'error', subgroup: null, message: 'Roster is empty — no subgroups defined.' }], boonCap: 5 }
  }
  const squadRoleCounts: Record<string, number> = {}

  roster.subgroups.forEach((sg, i) => {
    // Tally squad-wide first: these players exist regardless of subgroup validity.
    const counts: Record<string, number> = {}
    for (const e of sg) {
      if (!isRole(e.role)) {
        findings.push({
          severity: 'warning',
          subgroup: i,
          message: `Unknown role "${e.role}" for ${e.build} — cannot verify its coverage.`
        })
        continue
      }
      counts[e.role] = (counts[e.role] ?? 0) + 1
      squadRoleCounts[e.role] = (squadRoleCounts[e.role] ?? 0) + 1
    }

    if (sg.length === 0) {
      findings.push({ severity: 'warning', subgroup: i, message: `Subgroup ${i + 1} is empty — no builds assigned.` })
      return
    }
    if (sg.length > 5) {
      findings.push({
        severity: 'error',
        subgroup: i,
        message: `Subgroup ${i + 1} has ${sg.length} players — subgroups hold at most 5 players (GW2 Wiki).`
      })
      return // malformed size; per-subgroup coverage checks would be noise
    }

    // Tertiary Support is intentionally unconstrained (flex utility) — no dedicated check.
    const hasPureDps = (counts['Pure DPS'] ?? 0) > 0
    const hasStability = (counts['Primary Support'] ?? 0) > 0
    if (hasPureDps && !hasStability) {
      findings.push({
        severity: 'error',
        subgroup: i,
        message: `Subgroup ${i + 1} has Pure DPS but no Primary Support — no stability source for the subgroup.`
      })
    }
    if ((counts['Primary Support'] ?? 0) >= 2) {
      findings.push({
        severity: 'warning',
        subgroup: i,
        message: `Subgroup ${i + 1} doubles Primary Support — stability/boons cap at 5 targets, so the second is largely wasted here.`
      })
    }
  })

  // Squad-wide: strip and cleanse must exist somewhere. Sources give no fixed
  // ratio, so these are warnings (presence checks), not hard counts.
  if ((squadRoleCounts['Boon Strip DPS'] ?? 0) === 0) {
    findings.push({
      severity: 'warning',
      subgroup: null,
      message: 'No Boon Strip DPS anywhere — the squad cannot clear enemy stability to land CC and spikes.'
    })
  }
  if ((squadRoleCounts['Secondary Support'] ?? 0) === 0) {
    findings.push({
      severity: 'warning',
      subgroup: null,
      message: 'No Secondary Support anywhere — no dedicated healing/condition cleanse/barrier sustain.'
    })
  }

  return { findings, boonCap: 5 }
}
