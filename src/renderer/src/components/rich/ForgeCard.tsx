import { useEffect, useRef, type ReactElement } from 'react'
import {
  renderMiniBuildCard,
  renderCompCard,
  createHoverPreview,
  renderEntityHoverHtml
} from '@axiapps/forge-render'
import '@axiapps/forge-render/forge-render.css'
import type { DisplayPayload } from '../../state'
import { useForgeCatalog, type UpgradeCatalog } from './useForgeCatalog'

type CardDisplay = Extract<DisplayPayload, { kind: 'build-card' | 'comp-card' }>

type ForgeBuild = Record<string, unknown>

/** The most-equipped rune id on a build (mirrors forge-render's pick). */
function dominantRuneId(build: ForgeBuild): number | null {
  const runes = (build.equipment as { runes?: Record<string, unknown> } | undefined)?.runes
  if (!runes || typeof runes !== 'object') return null
  const counts = new Map<string, number>()
  for (const v of Object.values(runes)) {
    if (v) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best && /^\d+$/.test(best) ? Number(best) : null
}

/** Bind rune/relic hover cards inside one rendered .mini-card element. */
function bindBuildHovers(
  preview: ReturnType<typeof createHoverPreview>,
  card: HTMLElement,
  build: ForgeBuild,
  catalog: UpgradeCatalog
): void {
  const runeId = dominantRuneId(build)
  const rune = runeId !== null ? catalog.runeById.get(runeId) : undefined
  const runeCell = card.querySelector<HTMLElement>('.mini-card__equip')?.closest<HTMLElement>('.mini-card__cell')
  if (rune && runeCell) {
    preview.bind(runeCell, () =>
      renderEntityHoverHtml({ ...rune, facts: (rune.bonuses ?? []).map((text) => ({ text })) }, 'Rune')
    )
  }
  const relicName = (build.equipment as { relic?: string } | undefined)?.relic
  const relic = relicName ? catalog.relicByName.get(relicName) : undefined
  const relicCell = card.querySelector<HTMLElement>('.mini-card__relic')?.closest<HTMLElement>('.mini-card__cell')
  if (relic && relicCell) {
    preview.bind(relicCell, () => renderEntityHoverHtml(relic, 'Relic'))
  }
}

/**
 * React wrapper around the framework-free @axiapps/forge-render renderers.
 * The package emits HTML strings styled by CSS scoped under .forge-render,
 * so AxiForge cards keep their own look inside the newspaper theme.
 */
export default function ForgeCard({ display }: { display: CardDisplay }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const catalog = useForgeCatalog()

  useEffect(() => {
    const host = ref.current
    if (!host) return
    const builds: Record<string, ForgeBuild> =
      display.kind === 'build-card'
        ? { [(display.data.build.id as string) ?? '']: display.data.build }
        : display.data.builds
    if (display.kind === 'build-card') {
      host.innerHTML = renderMiniBuildCard(display.data.build, catalog, { showActions: false })
    } else {
      host.innerHTML = renderCompCard(display.data.comp, display.data.builds, catalog)
    }
    // Hover cards: rune/relic rows get name+bonus tooltips from the catalog,
    // bound within this card's container only.
    const preview = createHoverPreview(host)
    if (catalog) {
      for (const card of host.querySelectorAll<HTMLElement>('.mini-card[data-build-id]')) {
        const build = builds[card.dataset.buildId ?? '']
        if (build) bindBuildHovers(preview, card, build, catalog)
      }
    }
    return () => {
      preview.destroy()
      host.innerHTML = ''
    }
  }, [display, catalog])

  return <div className="rich forge-render forgecard" ref={ref} />
}
