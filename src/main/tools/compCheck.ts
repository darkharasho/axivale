// src/main/tools/compCheck.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe, safeRich } from './shared'
import { checkComp, type Roster } from '../meta/compCheck'

const entry = z.object({
  build: z.string().describe('Build name, e.g. "Support Firebrand"'),
  role: z
    .string()
    .describe('WvW squad role: Primary Support | Secondary Support | Tertiary Support | Boon Strip DPS | Pure DPS')
})

// Visual role buckets used to colour the comp sketch (distinct from comp_check's
// finer WvW role labels above).
const sketchRole = z.enum(['support', 'damage', 'utility'])
const sketchSlot = z.object({
  spec: z.string().describe('Profession or elite-spec name, e.g. "Firebrand" — used to look up the class icon'),
  role: sketchRole
})
const sketchBuild = z.object({
  spec: z.string().describe('Profession or elite-spec name (matches the class icon)'),
  role: sketchRole,
  count: z.number().optional().describe('How many of this build are in the comp (or per-squad average)'),
  weapons: z.string().optional().describe('Weapon set(s), e.g. "Axe/Shield · Staff"'),
  note: z.string().optional().describe('One-line role/build note')
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCompCheckTools(): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'comp_check',
      'Validate a proposed WvW squad composition for boon coverage and role gaps. ' +
        'Pass the roster as subgroups (each up to 5 builds, each tagged with its WvW role from meta_search). ' +
        'Returns structured findings: per-subgroup coverage errors (e.g. Pure DPS with no stability source), ' +
        'doubled stability source, oversized/empty subgroups, and squad-wide gaps (no boon strip, no cleanse/sustain). ' +
        'Errors are hard problems; warnings are advisories. Sources give no fixed squad-wide ratios, so ' +
        'squad-wide checks are presence-based. Fix the errors, then re-check.',
      {
        subgroups: z
          .array(z.array(entry))
          .describe('Subgroups of up to 5 builds each; the order is the subgroup number')
      },
      safe(async ({ subgroups }: { subgroups: Array<Array<{ build: string; role: string }>> }) => {
        const report = checkComp({ subgroups } as Roster)
        return {
          boonCap: report.boonCap,
          errors: report.findings.filter((f) => f.severity === 'error'),
          warnings: report.findings.filter((f) => f.severity === 'warning'),
          ok: report.findings.every((f) => f.severity !== 'error')
        }
      })
    ),
    tool(
      'comp_sketch',
      'Render a composition visually instead of as a markdown table. ALWAYS use this to present a comp — a proposed squad, a derived/meta comp, or one you are critiquing. ' +
        'Pass `builds` (one entry per distinct build, with spec name, visual role bucket, optional count, weapons, and a one-line note) and, when you have fixed slots, `subgroups` (each an array of {spec, role}) to draw the squad grid. ' +
        'Roles are visual buckets: support | damage | utility. Spec names must be real GW2 profession/elite-spec names so the class icons resolve.',
      {
        title: z.string().optional().describe('Heading, e.g. "WvW Zerg — 25"'),
        subtitle: z.string().optional().describe('Small heading detail, e.g. "5 parties · 12% support"'),
        subgroups: z
          .array(z.array(sketchSlot))
          .optional()
          .describe('Optional fixed slots: one array per subgroup/party; drives the icon grid'),
        builds: z.array(sketchBuild).describe('Per-build detail list shown under the grid')
      },
      safeRich(
        async (spec: {
          title?: string
          subtitle?: string
          subgroups?: Array<Array<{ spec: string; role: string }>>
          builds: Array<{ spec: string; role: string; count?: number; weapons?: string; note?: string }>
        }) => ({
          value: { rendered: true, builds: spec.builds.length, subgroups: spec.subgroups?.length ?? 0 },
          display: { kind: 'comp-sketch', data: spec }
        })
      )
    )
  ]
}
