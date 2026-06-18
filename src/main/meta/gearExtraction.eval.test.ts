import { describe, it, expect } from 'vitest'
import { scrapeBuildGear } from './buildGear'
import { gearCases } from './__evals__/gear/cases'
import { fixtureFetch, loadFixture, evalMode } from './__evals__/harness'
import type { FetchLike } from './snowcrows'

// Live/record mode validates against the real, public, no-auth GW2 API.
const realFetch: FetchLike = (url) => fetch(url, { headers: { 'User-Agent': 'AxiVale-eval' } })

describe('gear-extraction eval', () => {
  for (const c of gearCases) {
    it(c.id, async () => {
      const html = loadFixture('gear', c.id, 'html')
      expect(html, `missing HTML fixture for ${c.id}`).toBeTruthy()
      const f = fixtureFetch('gear', c.id, evalMode() === 'replay' ? undefined : realFetch)
      const gear = await scrapeBuildGear(html as string, c.profession, f)

      expect(gear, 'scrapeBuildGear returned null (empty gear regression)').toBeTruthy()
      if (!gear) return
      if (c.expect.stats) expect(gear.stats ?? '').toMatch(c.expect.stats)
      if (c.expect.runeCount != null) expect(gear.rune?.count).toBe(c.expect.runeCount)
      if (c.expect.runeName) expect(gear.rune?.name ?? '').toMatch(c.expect.runeName)
      if (c.expect.weapons != null) expect(gear.weapons.length).toBe(c.expect.weapons)
      if (c.expect.sigils != null) expect(gear.sigils.length).toBe(c.expect.sigils)
      if (c.expect.infusions != null) expect(gear.infusions.length).toBe(c.expect.infusions)
    })
  }
})
