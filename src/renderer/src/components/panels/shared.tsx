import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Hash } from 'lucide-react'
import { classIconUrl } from './classIcons'

/** Typed wrapper around the whitelisted AxiTools bridge. */
export function axi<T>(method: string, ...args: unknown[]): Promise<T> {
  return window.officer.axitools(method, ...args) as Promise<T>
}

/** Human-readable message from a bridge error, with IPC noise stripped. */
export function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export function isOffline(e: unknown): boolean {
  return errText(e).toLowerCase().includes('no server connected')
}

/** Public notice shown when no AxiVale server is connected. */
export function Offline(): ReactElement {
  return (
    <div className="notconn">
      Desk closed — no server connected.
      <br />
      File an <b>AxiVale key</b> under Settings to open this section.
    </div>
  )
}

/**
 * Two-click destructive action: first click arms the button ("confirm ✕")
 * for three seconds, second click fires.
 */
export function ZapButton({
  onConfirm,
  title
}: {
  onConfirm: () => void
  title?: string
}): ReactElement {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      className={`zap${armed ? ' armed' : ''}`}
      title={title}
      onClick={() => {
        window.clearTimeout(timer.current)
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
          timer.current = window.setTimeout(() => setArmed(false), 3000)
        }
      }}
    >
      {armed ? 'confirm ✕' : '✕'}
    </button>
  )
}

/**
 * GW2 class/elite-spec icon — the real wiki icon (profession color + black
 * outline), rendered as an image. Falls back to nothing when the name isn't
 * a known class/spec.
 */
export function ClassIcon({
  name,
  size = 18
}: {
  name: string | null | undefined
  size?: number
}): ReactElement | null {
  const url = classIconUrl(name)
  if (!url) return null
  return (
    <img
      className="classicon"
      src={url}
      alt={name ?? ''}
      title={name ?? undefined}
      width={size}
      height={size}
    />
  )
}

export interface Channel {
  id: string
  name: string
  type: string
  category_id?: string
}

export interface Role {
  id: string
  name: string
}

export interface Overview {
  channels: Channel[]
  roles: Role[]
}

export function textChannels(ov: Overview | null): Channel[] {
  return (ov?.channels ?? []).filter((c) => c.type === 'text')
}

export function channelName(ov: Overview | null, id: string | undefined | null): string {
  if (!id) return '—'
  const ch = ov?.channels.find((c) => String(c.id) === String(id))
  return ch ? `#${ch.name}` : String(id)
}

/** Channel reference with a lucide hash glyph instead of a literal "#". */
export function ChannelTag({
  ov,
  id
}: {
  ov: Overview | null
  id: string | undefined | null
}): ReactElement {
  if (!id) return <span className="chtag none">—</span>
  const ch = ov?.channels.find((c) => String(c.id) === String(id))
  return (
    <span className="chtag">
      <Hash size={12} aria-hidden="true" />
      {ch ? ch.name : String(id)}
    </span>
  )
}

export const WEEK_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEK_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]
