export type EntityType = 'skill' | 'trait' | 'item'
export interface EntityFact { label: string; value?: string }
export interface EntityCard {
  type: EntityType
  name: string
  icon?: string
  subtitle?: string
  description?: string
  facts: EntityFact[]
  wikiUrl: string
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

export function renderEntitySkeletonHtml(): string {
  return `<div class="axi-ecard axi-ecard--loading">
    <div class="axi-ecard__row m"></div><div class="axi-ecard__row"></div><div class="axi-ecard__row s"></div>
  </div>`
}

export function renderEntityEmptyHtml(name: string): string {
  return `<div class="axi-ecard"><div class="axi-ecard__body">No data for ${esc(name)}.</div></div>`
}

export function renderEntityCardHtml(card: EntityCard): string {
  const icon = card.icon ? `<img class="axi-ecard__icon" src="${esc(card.icon)}" alt="" />` : `<span class="axi-ecard__icon axi-ecard__icon--${card.type}"></span>`
  const desc = card.description ? `<p class="axi-ecard__desc">${esc(card.description)}</p>` : ''
  const facts = card.facts.length
    ? `<ul class="axi-ecard__facts">${card.facts
        .map((f) => `<li><span class="axi-ecard__dot"></span><span>${f.label ? esc(f.label) + ': ' : ''}<b>${esc(f.value ?? '')}</b></span></li>`)
        .join('')}</ul>`
    : ''
  return `<div class="axi-ecard axi-ecard--${card.type}">
    <div class="axi-ecard__hd">${icon}<div><div class="axi-ecard__nm">${esc(card.name)}</div><div class="axi-ecard__ty">${esc(card.subtitle ?? '')}</div></div></div>
    <div class="axi-ecard__body">${desc}${facts}</div>
    <div class="axi-ecard__ft"><a href="${esc(card.wikiUrl)}" target="_blank" rel="noopener noreferrer">Open wiki ↗</a></div>
  </div>`
}
