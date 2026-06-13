declare module '@axiapps/forge-render' {
  export function renderMiniBuildCard(
    build: Record<string, unknown>,
    catalog: unknown,
    options?: Record<string, unknown>
  ): string
  export function renderCompCard(
    comp: Record<string, unknown>,
    buildsById?: Record<string, Record<string, unknown>>,
    catalog?: unknown
  ): string
  export function createHoverPreview(host: HTMLElement): {
    bind: (target: HTMLElement, htmlProvider: string | (() => string)) => void
    hide: () => void
    destroy: () => void
  }
  export function renderEntityHoverHtml(
    entity: { name?: string; icon?: string; description?: string; facts?: Array<{ text: string; value?: unknown }> },
    meta?: string
  ): string
}
declare module '@axiapps/forge-render/forge-render.css'
