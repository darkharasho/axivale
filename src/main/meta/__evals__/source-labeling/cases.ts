// Seed source-labeling cases. The first guards the TODO.md regression: a gw2mists
// "DPS Warrior" build must be attributed to gw2mists with Berserker gear, and must
// NOT be cross-labeled to another site.
import type { SourceExcerpt } from '../../distill'
import type { SourceExpect } from '../grade'

export interface SourceCase {
  id: string
  mode: string
  excerpts: SourceExcerpt[]
  specMap?: Record<string, string>
  today?: string
  expect: SourceExpect
}

export const sourceCases: SourceCase[] = [
  {
    id: 'gw2mists-dps-warrior',
    mode: 'wvw',
    excerpts: [
      {
        source: 'gw2mists — "DPS Warrior"',
        text:
          'DPS Warrior. Focus: pressure & burst damage in coordinated fights. ' +
          "Style: melee range, power DPS. Gear: Berserker's armor. " +
          'URL: https://gw2mists.com/en/builds/warrior/dps-warrior'
      }
    ],
    expect: {
      include: [/Berserker/i, /gw2mists/i],
      exclude: [/snowcrows/i, /metabattle/i],
      domains: ['gw2mists.com']
    }
  }
]
