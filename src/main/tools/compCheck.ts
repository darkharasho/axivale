// src/main/tools/compCheck.ts
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safe } from './shared'
import { checkComp, type Roster } from '../meta/compCheck'

const entry = z.object({
  build: z.string().describe('Build name, e.g. "Support Firebrand"'),
  role: z
    .string()
    .describe('WvW squad role: Primary Support | Secondary Support | Tertiary Support | Boon Strip DPS | Pure DPS')
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
    )
  ]
}
