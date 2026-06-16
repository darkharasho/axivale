import type { ReactElement, ReactNode } from 'react'
import { EmojiIcon } from './emojiIcons'
import { classIconSvg } from './panels/classIconSvg'

/**
 * Inline GW2 class/elite-spec tag: the recognized name with its vector icon
 * (full color + black outline) tucked in front, sized to the surrounding text.
 * Falls back to the bare label when the name isn't a known class/spec.
 */
function ClassTag({ name, label }: { name: string; label: ReactNode }): ReactElement {
  const svg = classIconSvg(name)
  if (!svg) return <>{label}</>
  // Plain inline span so the label keeps the surrounding text baseline; only the
  // icon is shifted (inline-flex on the wrapper would lift the whole tag).
  return (
    <span className="axi-class" style={{ whiteSpace: 'nowrap' }}>
      <span
        className="axi-class-ico"
        aria-hidden="true"
        style={{
          display: 'inline-block',
          height: '1.1em',
          marginRight: '0.16em',
          verticalAlign: '-0.2em'
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {label}
    </span>
  )
}

/**
 * react-markdown `span` override that renders the marker spans emitted by both
 * rehypeEmojiIcons (emoji → icon) and rehypeClassIcons (class/spec → icon+name).
 * Anything else passes through untouched. Use in place of renderEmojiSpan when
 * the class-icon plugin is also enabled.
 */
export function renderRichSpan(
  props: React.ComponentPropsWithoutRef<'span'> & { node?: unknown }
): ReactElement {
  const { node: _node, className, children, ...rest } = props
  const classes = typeof className === 'string' ? className.split(/\s+/) : []
  const data = props as Record<string, unknown>

  if (classes.includes('axi-emoji')) {
    const emoji = data['data-emoji']
    if (typeof emoji === 'string' && emoji.length > 0) return <EmojiIcon emoji={emoji} />
  }
  if (classes.includes('axi-classicon')) {
    const name = data['data-class']
    if (typeof name === 'string' && name.length > 0) return <ClassTag name={name} label={children} />
  }
  return (
    <span className={className} {...rest}>
      {children}
    </span>
  )
}
