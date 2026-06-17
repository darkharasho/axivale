import type { EntityCard, EntityType } from './entityCard'
import { renderEntityCardHtml, renderEntitySkeletonHtml, renderEntityEmptyHtml } from './entityCard'

function wikiSearchUrl(name: string): string {
  return `https://wiki.guildwars2.com/index.php?search=${encodeURIComponent(name)}`
}

export function createEntityHover(host: HTMLElement): { destroy(): void } {
  const cache = new Map<string, EntityCard | null>()
  const pop = document.createElement('div')
  pop.className = 'axi-ecard-pop'
  pop.style.position = 'fixed'
  pop.style.zIndex = '9999'
  pop.style.display = 'none'
  document.body.appendChild(pop)

  function place(target: HTMLElement): void {
    const r = target.getBoundingClientRect()
    pop.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`
    pop.style.top = `${r.bottom + 6}px`
  }

  function find(e: Event): HTMLElement | null {
    const el = (e.target as HTMLElement)?.closest?.('.axi-entity')
    return el instanceof HTMLElement ? el : null
  }

  async function show(el: HTMLElement): Promise<void> {
    const type = el.dataset.entityType as EntityType | undefined
    const name = el.dataset.entityName
    if (!type || !name) return
    const key = `${type}:${name}`
    place(el)
    pop.style.display = 'block'
    if (cache.has(key)) {
      const card = cache.get(key) ?? null
      pop.innerHTML = card ? renderEntityCardHtml(card) : renderEntityEmptyHtml(name)
      return
    }
    pop.innerHTML = renderEntitySkeletonHtml()
    const card = await window.officer.resolveEntity({ type, name })
    if (card) cache.set(key, card) // do not cache misses
    if (pop.style.display === 'none') return // hidden while awaiting
    pop.innerHTML = card ? renderEntityCardHtml(card) : renderEntityEmptyHtml(name)
  }

  const onOver = (e: Event): void => { const el = find(e); if (el) void show(el) }
  const onOut = (e: Event): void => {
    const el = find(e)
    if (el && !pop.contains((e as MouseEvent).relatedTarget as Node)) pop.style.display = 'none'
  }
  const onClick = (e: Event): void => {
    const el = find(e)
    if (!el) return
    const name = el.dataset.entityName ?? ''
    const type = el.dataset.entityType as EntityType
    const key = `${type}:${name}`
    const url = cache.get(key)?.wikiUrl ?? wikiSearchUrl(name)
    window.open(url, '_blank', 'noopener')
  }

  host.addEventListener('mouseover', onOver)
  host.addEventListener('mouseout', onOut)
  host.addEventListener('click', onClick)

  return {
    destroy(): void {
      host.removeEventListener('mouseover', onOver)
      host.removeEventListener('mouseout', onOut)
      host.removeEventListener('click', onClick)
      pop.remove()
    }
  }
}
