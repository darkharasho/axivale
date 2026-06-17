import { describe, it, expect } from 'vitest'
import { AXIVALE_SYSTEM_PROMPT } from './agent'

describe('system prompt', () => {
  it('describes the AxiForge capabilities and confirm flow', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/headless/i)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/deletes and publishes prompt the user to confirm/i)
  })

  it('requires grounding build edits in catalog/API data, not model memory', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_catalog')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/balance patches invalidate your training data/i)
  })

  it('separates the AxiForge store from the AxiTools Discord store', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/axiforge_\* .*axitools_builds_\*/s)
  })

  it('instructs inline {{figure}} placement, not piling figures at the end', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('{{figure}}')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/do NOT\s+pile every figure at the end/i)
  })

  it('forbids enumerating every run/report', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/never list out every run\/report/i)
  })

  it('offers both gw2skills parse and import, and chat-link sharing', () => {
    // A pasted gw2skills link: offer parse (preview) AND import (rebuild), not one silently.
    expect(AXIVALE_SYSTEM_PROMPT).toContain('gw2skills_parse')
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_import_gw2skills')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/offer both/i)
    // Sharing a build via the in-game chat code.
    expect(AXIVALE_SYSTEM_PROMPT).toContain('axiforge_build_chat_link')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/chat code/i)
  })

  it('explains Discord paging and the discord_search scan cap', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('discord_search')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/before.*oldest/i)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/reachedCap|scan cap/i)
  })

  it('frames WvW comps around subgroup boon coverage, not a fixed 5-slot list', () => {
    const p = AXIVALE_SYSTEM_PROMPT
    expect(p).toMatch(/subgroup/i)
    expect(p).toMatch(/boon strip|boon corrupt/i)
    expect(p).toMatch(/meta_search/)
    expect(p).not.toContain('a standard party covers five roles')
    expect(p).toMatch(/WvW does NOT run quickness.*like PvE/i)
  })

  it('tells the model to validate WvW rosters with comp_check', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/comp_check/)
  })

  it('forbids fabricated stats and guessed citation URLs', () => {
    const p = AXIVALE_SYSTEM_PROMPT
    expect(p).toMatch(/no fabricated evidence/i)
    expect(p).toMatch(/popularity/i)
    expect(p).toMatch(/never write a url you did not receive/i)
  })

  it('requires a source for every recommended/tier-labeled build and flags bare "core" picks', () => {
    const p = AXIVALE_SYSTEM_PROMPT
    expect(p).toMatch(/A build with no source is not a recommendation/i)
    expect(p).toMatch(/Core <profession>/i)
  })

  it('makes source recency part of correctness', () => {
    const p = AXIVALE_SYSTEM_PROMPT
    expect(p).toMatch(/recency is part of correctness/i)
    expect(p).toMatch(/most recent tier list/i)
  })

  it('nudges proactive durable memory (remember/recall)', () => {
    const p = AXIVALE_SYSTEM_PROMPT
    expect(p).toMatch(/durable memory/i)
    expect(p).toMatch(/remember/)
    expect(p).toMatch(/recall/)
    expect(p).toMatch(/standing fact/i)
  })

  it('instructs the model to wrap GW2 skills/traits/items with [[type:Name]] markers', () => {
    expect(AXIVALE_SYSTEM_PROMPT).toContain('[[skill:')
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/\[\[trait:/)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/\[\[item:/)
    expect(AXIVALE_SYSTEM_PROMPT).toMatch(/canonical in-game name/i)
  })
})
