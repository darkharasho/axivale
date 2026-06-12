import { CLASS_ICON_DATA } from './classIconData'

/**
 * GW2 class/elite-spec icons (from gw2-class-icons) as inlined data URIs for
 * CSS masking — monochrome shapes painted in theme colors. Regenerate the
 * data module with `node scripts/gen-class-icons.cjs`.
 */
export function classIconUrl(name: string | null | undefined): string | null {
  if (!name) return null
  return CLASS_ICON_DATA[name.trim().toLowerCase()] ?? null
}
