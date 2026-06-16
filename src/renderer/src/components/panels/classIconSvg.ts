import { CLASS_ICON_SVG_DATA } from './classIconSvgData'

/**
 * GW2 class/elite-spec icons (from gw2-class-icons) as inline, render-ready SVG
 * markup — full color + black outline, crisp at any size. Looked up by the
 * profession or elite-spec name (case-insensitive). Regenerate the data module
 * with `node scripts/gen-class-icons-svg.cjs`.
 */
export function classIconSvg(name: string | null | undefined): string | null {
  if (!name) return null
  return CLASS_ICON_SVG_DATA[name.trim().toLowerCase()] ?? null
}

/** Whether a name resolves to a known class/elite-spec icon. */
export function hasClassIcon(name: string | null | undefined): boolean {
  return classIconSvg(name) != null
}
