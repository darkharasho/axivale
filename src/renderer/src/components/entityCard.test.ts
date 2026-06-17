import { describe, it, expect } from 'vitest'
import { renderEntityCardHtml, renderEntityEmptyHtml } from './entityCard'

describe('renderEntityCardHtml', () => {
  it('includes the name, subtitle, each fact, and the wiki link', () => {
    const html = renderEntityCardHtml({
      type: 'skill', name: 'Shelter', subtitle: 'Skill',
      facts: [{ label: 'Recharge', value: '30s' }], wikiUrl: 'https://wiki.guildwars2.com/wiki/Shelter'
    })
    expect(html).toContain('Shelter')
    expect(html).toContain('Skill')
    expect(html).toContain('Recharge')
    expect(html).toContain('30s')
    expect(html).toContain('https://wiki.guildwars2.com/wiki/Shelter')
  })
  it('escapes HTML in the name to prevent injection', () => {
    const html = renderEntityCardHtml({
      type: 'item', name: '<img src=x>', subtitle: 'Item', facts: [], wikiUrl: 'https://x'
    })
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;img')
  })
  it('label-only fact renders text without trailing colon or empty bold tag', () => {
    const html = renderEntityCardHtml({
      type: 'skill', name: 'Test', subtitle: 'Skill',
      facts: [{ label: 'Might ×3 (8s)' }], wikiUrl: 'https://x'
    })
    expect(html).toContain('Might ×3 (8s)')
    expect(html).not.toContain('<b></b>')
    expect(html).not.toContain(': <b>')
  })
  it('label + value fact renders label: <b>value</b>', () => {
    const html = renderEntityCardHtml({
      type: 'skill', name: 'Test', subtitle: 'Skill',
      facts: [{ label: 'Recharge', value: '4s' }], wikiUrl: 'https://x'
    })
    expect(html).toContain('Recharge: ')
    expect(html).toContain('<b>4s</b>')
  })
})

describe('renderEntityEmptyHtml', () => {
  it('shows a no-data message with the escaped name', () => {
    expect(renderEntityEmptyHtml('Shelter')).toContain('Shelter')
  })
})
