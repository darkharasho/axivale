// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEntityHover } from './entityHover'

function makeEntity(): HTMLElement {
  const s = document.createElement('span')
  s.className = 'axi-entity'
  s.dataset.entityType = 'skill'
  s.dataset.entityName = 'Shelter'
  s.textContent = 'Shelter'
  return s
}

function pop(): HTMLElement {
  return document.querySelector('.axi-ecard-pop') as HTMLElement
}

describe('createEntityHover — card reachability', () => {
  let host: HTMLElement
  let handle: { destroy(): void }

  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
    ;(window as unknown as { officer: unknown }).officer = {
      resolveEntity: vi.fn().mockResolvedValue({
        type: 'skill',
        name: 'Shelter',
        subtitle: 'Skill',
        facts: [],
        wikiUrl: 'https://wiki.guildwars2.com/wiki/Shelter'
      })
    }
  })

  afterEach(() => {
    handle?.destroy()
    vi.useRealTimers()
  })

  it('does not hide immediately on leaving the trigger — it waits, then hides', async () => {
    const el = makeEntity()
    host.appendChild(el)
    handle = createEntityHover(host)

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(pop().style.display).toBe('block')

    vi.useFakeTimers()
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    expect(pop().style.display).toBe('block') // grace period, not gone yet

    vi.advanceTimersByTime(300)
    expect(pop().style.display).toBe('none')
  })

  it('cancels the pending hide when the pointer reaches the card', async () => {
    const el = makeEntity()
    host.appendChild(el)
    handle = createEntityHover(host)

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    vi.useFakeTimers()
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    pop().dispatchEvent(new MouseEvent('mouseenter'))

    vi.advanceTimersByTime(300)
    expect(pop().style.display).toBe('block') // stayed open so "Open wiki" is clickable
  })

  it('keeps the card open when moving from the trigger directly onto it', async () => {
    const el = makeEntity()
    host.appendChild(el)
    handle = createEntityHover(host)

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    // relatedTarget is the card → must not even schedule a hide
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: pop() }))
    expect(pop().style.display).toBe('block')
  })
})
