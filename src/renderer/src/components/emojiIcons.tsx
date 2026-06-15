import type { ReactElement } from 'react'
import emojiRegex from 'emoji-regex'
import EMOJI_DATA from 'unicode-emoji-json'
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  Castle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Coins,
  Crown,
  Eye,
  Flame,
  Folder,
  Hammer,
  HelpCircle,
  Lightbulb,
  Mail,
  Map,
  MessageSquare,
  PartyPopper,
  Pin,
  Rocket,
  Scroll,
  Search,
  Shield,
  Sparkles,
  Star,
  Swords,
  Target,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  Users,
  Wrench,
  XCircle,
  type LucideIcon
} from 'lucide-react'

// Curated emoji → Lucide icon. Unmapped emoji fall back to the Fluent
// high-contrast set via Iconify, masked in the accent color.
const EMOJI_TO_ICON: Record<string, LucideIcon> = {
  '✅': CheckCircle2,
  '✔️': CheckCircle2,
  '❌': XCircle,
  '✖️': XCircle,
  '⚠️': AlertTriangle,
  '❗': AlertCircle,
  '❓': HelpCircle,
  '💡': Lightbulb,
  '🔥': Flame,
  '🚀': Rocket,
  '🔧': Wrench,
  '🛠️': Hammer,
  '📋': ClipboardList,
  '📌': Pin,
  '📁': Folder,
  '📂': Folder,
  '🗺️': Map,
  '⚔️': Swords,
  '🗡️': Swords,
  '🛡️': Shield,
  '🏰': Castle,
  '👑': Crown,
  '🎯': Target,
  '🏆': Trophy,
  '⏰': Clock,
  '⏱️': Clock,
  '🕐': Clock,
  '📅': Calendar,
  '🗓️': Calendar,
  '✉️': Mail,
  '📧': Mail,
  '💬': MessageSquare,
  '👍': ThumbsUp,
  '👎': ThumbsDown,
  '🎉': PartyPopper,
  '✨': Sparkles,
  '⭐': Star,
  '🌟': Star,
  '👥': Users,
  '👤': Users,
  '🔔': Bell,
  '🔍': Search,
  '🔎': Search,
  '👁️': Eye,
  '📜': Scroll,
  '💰': Coins,
  '🪙': Coins
}

const SKIN_TONES = /[\u{1F3FB}-\u{1F3FF}]/gu
const VARIATION = /️/g

// Colored-shape emoji → their actual CSS color.
// These are rendered with the Fluent mask but tinted to the real color
// rather than the accent, so color information is preserved.
const COLOR_EMOJI: Record<string, string> = {
  // Circles
  '🔴': '#e0352b',
  '🟠': '#e67e22',
  '🟡': '#f1c40f',
  '🟢': '#2ecc71',
  '🔵': '#3498db',
  '🟣': '#9b59b6',
  '🟤': '#8a5a2b',
  '⚫': '#2c2c2c',
  '⚪': '#d8d8d8',
  // Squares (same palette as circles)
  '🟥': '#e0352b',
  '🟧': '#e67e22',
  '🟨': '#f1c40f',
  '🟩': '#2ecc71',
  '🟦': '#3498db',
  '🟪': '#9b59b6',
  '🟫': '#8a5a2b',
  '⬛': '#2c2c2c',
  '⬜': '#d8d8d8'
}

function lookupColor(emoji: string): string | undefined {
  return (
    COLOR_EMOJI[emoji] ??
    COLOR_EMOJI[emoji.replace(VARIATION, '')] ??
    COLOR_EMOJI[emoji + '️']
  )
}

export function makeEmojiRegex(): RegExp {
  return emojiRegex()
}

function lookupIcon(emoji: string): LucideIcon | undefined {
  return (
    EMOJI_TO_ICON[emoji] ??
    EMOJI_TO_ICON[emoji.replace(VARIATION, '')] ??
    EMOJI_TO_ICON[emoji + '️']
  )
}

interface EmojiEntry {
  slug: string
}

export function fluentEmojiSlug(emoji: string): string | null {
  const data = EMOJI_DATA as unknown as Record<string, EmojiEntry>
  const entry = data[emoji] ?? data[emoji.replace(SKIN_TONES, '')] ?? data[emoji.replace(VARIATION, '')]
  return entry ? entry.slug.replace(/_/g, '-') : null
}

export function fluentEmojiUrl(emoji: string): string | null {
  const slug = fluentEmojiSlug(emoji)
  return slug ? `https://api.iconify.design/fluent-emoji-high-contrast/${slug}.svg` : null
}

export function EmojiIcon({ emoji }: { emoji: string }): ReactElement {
  const Icon = lookupIcon(emoji)
  if (Icon) {
    return <Icon className="axi-emoji-icon" strokeWidth={2.25} aria-label={emoji} />
  }
  const url = fluentEmojiUrl(emoji)
  if (url) {
    const color = lookupColor(emoji)
    return (
      <span
        role="img"
        aria-label={emoji}
        title={emoji}
        className="axi-emoji-mask"
        style={{
          WebkitMaskImage: `url(${url})`,
          maskImage: `url(${url})`,
          ...(color ? { backgroundColor: color } : {})
        }}
      />
    )
  }
  return <>{emoji}</>
}

/** react-markdown `span` override: render marker spans from rehypeEmojiIcons as icons. */
export function renderEmojiSpan(
  props: React.ComponentPropsWithoutRef<'span'> & { node?: unknown }
): ReactElement {
  const { node: _node, className, children, ...rest } = props
  if (typeof className === 'string' && className.split(/\s+/).includes('axi-emoji')) {
    const emoji = (props as Record<string, unknown>)['data-emoji']
    if (typeof emoji === 'string' && emoji.length > 0) return <EmojiIcon emoji={emoji} />
  }
  return (
    <span className={className} {...rest}>
      {children}
    </span>
  )
}

// Markdown links (e.g. build source links in a table) open in a new tab/external
// browser instead of navigating away from the article or share.
export function renderExtLink(
  props: React.ComponentPropsWithoutRef<'a'> & { node?: unknown }
): ReactElement {
  const { node: _node, children, ...rest } = props
  return (
    <a {...rest} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
