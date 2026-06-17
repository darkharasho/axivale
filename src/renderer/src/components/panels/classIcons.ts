import { CLASS_ICON_DATA } from './classIconData'
import { lookupClassIcon } from './classIconKey'

/**
 * GW2 class/elite-spec icons (from gw2-class-icons) as inlined data URIs for
 * CSS masking — monochrome shapes painted in theme colors. Regenerate the
 * data module with `node scripts/gen-class-icons.cjs`. Tolerates "core"
 * qualifiers and plurals (see classIconKeys).
 */
export function classIconUrl(name: string | null | undefined): string | null {
  return lookupClassIcon(CLASS_ICON_DATA, name)
}
