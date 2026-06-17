import type { EntityCard, EntityType } from './entityCard'
import { renderEntityCardHtml, renderEntitySkeletonHtml, renderEntityEmptyHtml } from './entityCard'

const HIDE_DELAY_MS = 220 // grace period to cross the gap from link → card
const GAP = 6
const MARGIN = 8

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

  let current: HTMLElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function cancelHide(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }
  function hideNow(): void {
    cancelHide()
    pop.style.display = 'none'
    current = null
  }
  function scheduleHide(): void {
    cancelHide()
    hideTimer = setTimeout(hideNow, HIDE_DELAY_MS)
  }

  function find(e: Event): HTMLElement | null {
    const el = (e.target as HTMLElement)?.closest?.('.axi-entity')
    return el instanceof HTMLElement ? el : null
  }

  // Place the card next to `current`, flipping above and clamping to the
  // viewport so the footer ("Open wiki") is never clipped off-screen.
  function position(): void {
    if (!current) return
    const maxH = window.innerHeight - 2 * MARGIN
    pop.style.maxHeight = `${maxH}px`
    pop.style.overflowY = 'auto'
    const r = current.getBoundingClientRect()
    const ph = Math.min(pop.offsetHeight || 0, maxH)
    const pw = pop.offsetWidth || 0
    const below = r.bottom + GAP
    const fitsBelow = below + ph <= window.innerHeight - MARGIN
    const top = fitsBelow ? below : Math.max(MARGIN, r.top - GAP - ph)
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - pw - MARGIN))
    pop.style.left = `${left}px`
    pop.style.top = `${top}px`
  }

  async function show(el: HTMLElement): Promise<void> {
    const type = el.dataset.entityType as EntityType | undefined
    const name = el.dataset.entityName
    if (!type || !name) return
    cancelHide()
    current = el
    const key = `${type}:${name}`
    pop.style.display = 'block'
    if (cache.has(key)) {
      const card = cache.get(key) ?? null
      pop.innerHTML = card ? renderEntityCardHtml(card) : renderEntityEmptyHtml(name)
      position()
      return
    }
    pop.innerHTML = renderEntitySkeletonHtml()
    position()
    const card = await window.officer.resolveEntity({ type, name })
    if (card) cache.set(key, card) // do not cache misses
    if (current !== el || pop.style.display === 'none') return // moved away / hidden while awaiting
    pop.innerHTML = card ? renderEntityCardHtml(card) : renderEntityEmptyHtml(name)
    position()
  }

  const onOver = (e: Event): void => {
    const el = find(e)
    if (el) void show(el)
  }
  const onOut = (e: Event): void => {
    const el = find(e)
    if (!el) return
    const to = (e as MouseEvent).relatedTarget as Node | null
    // Moving within the trigger, or onto the card itself, must NOT dismiss it.
    if (to && (el.contains(to) || pop.contains(to) || pop === to)) return
    scheduleHide()
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

  // Keep the card alive while the pointer is over it; dismiss shortly after.
  const onPopEnter = (): void => cancelHide()
  const onPopLeave = (): void => scheduleHide()

  host.addEventListener('mouseover', onOver)
  host.addEventListener('mouseout', onOut)
  host.addEventListener('click', onClick)
  pop.addEventListener('mouseenter', onPopEnter)
  pop.addEventListener('mouseleave', onPopLeave)

  return {
    destroy(): void {
      cancelHide()
      host.removeEventListener('mouseover', onOver)
      host.removeEventListener('mouseout', onOut)
      host.removeEventListener('click', onClick)
      pop.remove()
    }
  }
}
