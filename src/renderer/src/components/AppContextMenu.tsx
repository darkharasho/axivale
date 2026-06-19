import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  Copy,
  Scissors,
  ClipboardPaste,
  TextSelect,
  ExternalLink,
  Link2,
  Table2,
  Image as ImageIcon,
  Share2
} from 'lucide-react'

/**
 * A global, theme-matched right-click menu. One instance is mounted at the app
 * root; it intercepts every `contextmenu`, inspects what's under the cursor, and
 * offers the actions that fit — copy/cut/paste in fields, copy + copy-as-image +
 * share on a message, open/copy a link, copy-as-CSV on a data table, and a copy/
 * select-all fallback elsewhere. Renderer-only: text goes through the async
 * Clipboard API and links reuse the app's open-in-OS-browser route (window.open).
 */

interface MenuItem {
  label: string
  icon: ReactNode
  shortcut?: string
  disabled?: boolean
  run?: () => void | Promise<void>
}
type MenuGroup = MenuItem[]

interface MenuState {
  x: number
  y: number
  groups: MenuGroup[]
}

const ICON = 13

// ── clipboard + field helpers ──────────────────────────────────────────────

function selectionText(): string {
  return window.getSelection()?.toString() ?? ''
}

async function writeText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* clipboard denied — nothing we can do from here */
  }
}

/** React owns the value of controlled inputs, so we can't just set `.value` — set
 *  it through the native setter and fire an `input` event so React's onChange runs. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    // password/number/etc. still take cut/copy/paste; only non-text widgets opt out
    return !['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit'].includes(el.type)
  }
  return false
}

function fieldSelection(el: HTMLInputElement | HTMLTextAreaElement): { start: number; end: number } {
  return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
}

function csvCell(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

function tableToCsv(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((row) => Array.from(row.cells).map((c) => csvCell(c.textContent ?? '')).join(','))
    .join('\n')
}

function articleText(art: Element): string {
  const lede = art.querySelector('.lede')?.textContent?.trim() ?? ''
  const prose =
    art
      .querySelector('.prose')
      ?.textContent?.replace(/∎\s*$/, '')
      .trim() ?? ''
  return [lede, prose].filter(Boolean).join('\n\n')
}

/** Put `node`'s text content into the live selection (for a content "Select all"). */
function selectNode(node: Element): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(node)
  sel.removeAllRanges()
  sel.addRange(range)
}

// ── context → menu groups ──────────────────────────────────────────────────

function buildGroups(target: Element): MenuGroup[] {
  const sel = selectionText()
  const hasSel = sel.trim().length > 0

  // 1) Editable field: the only place cut/paste make sense. Most specific — return.
  const field = target.closest('input, textarea') as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
  if (field && isTextField(field)) {
    const { start, end } = fieldSelection(field)
    const hasFieldSel = end > start
    const copyCut = (cut: boolean): (() => Promise<void>) => async () => {
      const { start: s, end: e } = fieldSelection(field)
      if (e <= s) return
      await writeText(field.value.slice(s, e))
      if (cut) {
        setNativeValue(field, field.value.slice(0, s) + field.value.slice(e))
        field.focus()
        field.setSelectionRange(s, s)
      }
    }
    const paste = async (): Promise<void> => {
      let text = ''
      try {
        text = await navigator.clipboard.readText()
      } catch {
        return
      }
      if (!text) return
      const { start: s, end: e } = fieldSelection(field)
      setNativeValue(field, field.value.slice(0, s) + text + field.value.slice(e))
      const pos = s + text.length
      field.focus()
      field.setSelectionRange(pos, pos)
    }
    return [
      [
        { label: 'Cut', icon: <Scissors size={ICON} />, shortcut: 'Ctrl+X', disabled: field.disabled || field.readOnly || !hasFieldSel, run: copyCut(true) },
        { label: 'Copy', icon: <Copy size={ICON} />, shortcut: 'Ctrl+C', disabled: !hasFieldSel, run: copyCut(false) },
        { label: 'Paste', icon: <ClipboardPaste size={ICON} />, shortcut: 'Ctrl+V', disabled: field.disabled || field.readOnly, run: paste }
      ],
      [
        {
          label: 'Select all',
          icon: <TextSelect size={ICON} />,
          shortcut: 'Ctrl+A',
          run: () => {
            field.focus()
            field.select()
          }
        }
      ]
    ]
  }

  const groups: MenuGroup[] = []

  // 2) Base copy (selection): present everywhere, disabled when nothing's selected.
  groups.push([
    { label: 'Copy', icon: <Copy size={ICON} />, shortcut: 'Ctrl+C', disabled: !hasSel, run: () => writeText(sel) }
  ])

  // 3) A link.
  const link = target.closest('a[href]') as HTMLAnchorElement | null
  if (link) {
    const href = link.href
    groups.push([
      { label: 'Open link', icon: <ExternalLink size={ICON} />, run: () => void window.open(href, '_blank', 'noopener') },
      { label: 'Copy link', icon: <Link2 size={ICON} />, run: () => writeText(href) }
    ])
  }

  // 4) A data table (tool results / rich tables).
  const table = target.closest('table') as HTMLTableElement | null
  if (table) {
    const cell = target.closest('td, th') as HTMLTableCellElement | null
    const tg: MenuGroup = [
      { label: 'Copy as CSV', icon: <Table2 size={ICON} />, run: () => writeText(tableToCsv(table)) }
    ]
    if (cell) {
      tg.push({ label: 'Copy cell', icon: <Copy size={ICON} />, run: () => writeText((cell.textContent ?? '').trim()) })
    }
    groups.push(tg)
  }

  // 5) A message (assistant article). Reuse the card's own copy-as-image / share
  //    buttons when present (they only render once the turn is done).
  const article = target.closest('.msg.off') as HTMLElement | null
  if (article) {
    const ag: MenuGroup = [
      { label: 'Copy message', icon: <Copy size={ICON} />, run: () => writeText(articleText(article)) }
    ]
    const imgBtn = article.querySelector<HTMLButtonElement>('.clip-img-btn')
    if (imgBtn) ag.push({ label: 'Copy as image', icon: <ImageIcon size={ICON} />, run: () => imgBtn.click() })
    const shareBtn = article.querySelector<HTMLButtonElement>('.share-msg-btn')
    if (shareBtn) ag.push({ label: 'Share response', icon: <Share2 size={ICON} />, run: () => shareBtn.click() })
    groups.push(ag)

    // "Select all" here means the message body, not the whole document.
    groups.push([
      { label: 'Select all', icon: <TextSelect size={ICON} />, run: () => selectNode(article.querySelector('.prose') ?? article) }
    ])
  }

  return groups
}

// ── component ───────────────────────────────────────────────────────────────

export default function AppContextMenu(): ReactElement | null {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onContext = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (!target) return
      // Let our own menu's right-clicks fall through to a fresh native gesture.
      if (ref.current?.contains(target)) return
      const groups = buildGroups(target).filter((g) => g.length > 0)
      if (groups.length === 0) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, groups })
    }
    window.addEventListener('contextmenu', onContext)
    return () => window.removeEventListener('contextmenu', onContext)
  }, [])

  // Dismiss on any outside interaction.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    // mousedown (capture) so a click that lands on an action still runs first
    window.addEventListener('mousedown', close, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Keep the menu inside the viewport: flip/clamp after it measures.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const el = ref.current
    const { width, height } = el.getBoundingClientRect()
    const pad = 6
    let { x, y } = menu
    if (x + width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - width - pad)
    if (y + height + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - height - pad)
    if (x !== menu.x || y !== menu.y) el.style.transform = `translate(${x - menu.x}px, ${y - menu.y}px)`
  }, [menu])

  if (!menu) return null

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      // our own right-clicks shouldn't bubble to the document handler
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="ctx-sep" />}
          {group.map((item, ii) => (
            <button
              key={ii}
              type="button"
              role="menuitem"
              className={`ctx-item${item.disabled ? ' dis' : ''}`}
              disabled={item.disabled}
              // mousedown so the action fires before the outside-close handler
              onMouseDown={(e) => {
                e.preventDefault()
                if (item.disabled) return
                setMenu(null)
                void item.run?.()
              }}
            >
              <span className="ctx-k">
                <span className="ctx-ico">{item.icon}</span>
                {item.label}
              </span>
              {item.shortcut && <span className="ctx-sc">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
