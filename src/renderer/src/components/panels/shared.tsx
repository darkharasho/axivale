import { useEffect, useRef, useState, type ReactElement } from 'react'

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
