import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The renderer suite runs in the node environment, so the two browser globals
// this module touches are stubbed rather than pulling in jsdom for one file.
type FakeRoot = {
  attrs: Record<string, string>
  classes: Set<string>
  setAttribute: (k: string, v: string) => void
  removeAttribute: (k: string) => void
  classList: { add: (c: string) => void; remove: (c: string) => void }
}

function fakeRoot(): FakeRoot {
  const attrs: Record<string, string> = {}
  const classes = new Set<string>()
  return {
    attrs,
    classes,
    setAttribute: (k, v) => {
      attrs[k] = v
    },
    removeAttribute: (k) => {
      delete attrs[k]
    },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }
  }
}

let root: FakeRoot
let store: Map<string, string>

beforeEach(() => {
  vi.resetModules()
  root = fakeRoot()
  store = new Map()
  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function load() {
  return import('./applyTheme')
}

describe('resolveSurfaceId', () => {
  it('defaults to the language itself', async () => {
    const { resolveSurfaceId, DEFAULT_SURFACE_ID } = await load()
    expect(DEFAULT_SURFACE_ID).toBe('axi')
    expect(resolveSurfaceId(null)).toBe('axi')
    expect(resolveSurfaceId(undefined)).toBe('axi')
  })

  it('passes through the ids the design language defines', async () => {
    const { resolveSurfaceId } = await load()
    expect(resolveSurfaceId('axi')).toBe('axi')
    expect(resolveSurfaceId('flat')).toBe('flat')
    expect(resolveSurfaceId('glass')).toBe('glass')
  })

  it('falls back to axi for anything else, including inherited property names', async () => {
    const { resolveSurfaceId } = await load()
    expect(resolveSurfaceId('frosted')).toBe('axi')
    expect(resolveSurfaceId('')).toBe('axi')
    expect(resolveSurfaceId('constructor')).toBe('axi')
    expect(resolveSurfaceId('__proto__')).toBe('axi')
    expect(resolveSurfaceId('toString')).toBe('axi')
  })
})

describe('readSurface', () => {
  it('is axi when nothing has been mirrored', async () => {
    const { readSurface } = await load()
    expect(readSurface()).toBe('axi')
  })

  it('reads back a mirrored surface', async () => {
    store.set('axivale.surface', 'glass')
    const { readSurface } = await load()
    expect(readSurface()).toBe('glass')
  })

  // Review Focus 1
  it('is axi when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      }
    })
    const { readSurface } = await load()
    expect(readSurface()).toBe('axi')
  })
})

describe('applySurface', () => {
  it('puts a theme on <html> and mirrors it', async () => {
    const { applySurface } = await load()
    applySurface('glass')
    expect(root.attrs['data-axi-theme']).toBe('glass')
    expect(store.get('axivale.surface')).toBe('glass')
  })

  it('treats flat as a theme like any other', async () => {
    const { applySurface } = await load()
    applySurface('flat')
    expect(root.attrs['data-axi-theme']).toBe('flat')
  })

  it('removes the attribute for axi rather than naming the language', async () => {
    const { applySurface } = await load()
    applySurface('glass')
    applySurface('axi')
    expect(root.attrs['data-axi-theme']).toBeUndefined()
    expect(store.get('axivale.surface')).toBe('axi')
  })

  it('crossfades so the whole app repaints together', async () => {
    const { applySurface } = await load()
    applySurface('glass')
    expect(root.classes.has('theme-transitioning')).toBe(true)
  })

  // Review Focus 1
  it('still applies the surface when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage disabled')
      }
    })
    const { applySurface } = await load()
    applySurface('glass')
    expect(root.attrs['data-axi-theme']).toBe('glass')
  })
})

describe('applySurfaceSetting', () => {
  it('keeps the new surface when the store accepts it', async () => {
    const { applySurfaceSetting } = await load()
    const settled = await applySurfaceSetting('glass', 'axi', async () => undefined)
    expect(settled).toBe('glass')
    expect(root.attrs['data-axi-theme']).toBe('glass')
  })

  // Review Focus 5 — a refused write must not leave the window showing a
  // surface the store does not hold, or it reads as the app forgetting.
  it('rolls back to the previous surface when the store refuses', async () => {
    const { applySurfaceSetting } = await load()
    const settled = await applySurfaceSetting('glass', 'flat', async () => {
      throw new Error('store locked')
    })
    expect(settled).toBe('flat')
    expect(root.attrs['data-axi-theme']).toBe('flat')
    expect(store.get('axivale.surface')).toBe('flat')
  })

  it('rolls back to axi by removing the attribute, not by naming it', async () => {
    const { applySurfaceSetting } = await load()
    const settled = await applySurfaceSetting('glass', 'axi', async () => {
      throw new Error('store locked')
    })
    expect(settled).toBe('axi')
    expect(root.attrs['data-axi-theme']).toBeUndefined()
  })
})

describe('the crossfade stylesheet', () => {
  it('transitions on the class and turns itself off under reduced motion', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../theme.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.theme-transitioning \*/)
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    // The opt-out must apply to the crossfade, not merely exist somewhere in
    // the file.
    const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'))
    expect(reduced).toMatch(/\.theme-transitioning \*[\s\S]*transition: none/)
  })

  it('paints the glass ground image on body, not just the ground colour', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(new URL('../theme.css', import.meta.url), 'utf8')
    expect(css).toMatch(/background-image:\s*var\(--axi-ground-image\)/)
  })
})
