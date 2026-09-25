import type { ReactElement } from 'react'
import { Pane, Card, Field } from '../panelui'

export interface NotificationsProps {
  /** Desktop/system notifications enabled. */
  system: boolean
  /** App-icon unread badge enabled. */
  badge: boolean
  onToggleSystem: (value: boolean) => void
  onToggleBadge: (value: boolean) => void
}

function Toggle({
  on,
  onChange
}: {
  on: boolean
  onChange: (value: boolean) => void
}): ReactElement {
  // The track holds nothing but the knob: the knob's travel is a calc over the
  // track's own width and border tokens, so a label inside it would push the
  // slug through the right-hand edge. The label sits beside it instead.
  return (
    <span className="sk2-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="axi-switch"
        onClick={() => onChange(!on)}
      >
        <span className="axi-switch__knob" />
      </button>
      <span className="sk2-toggle__lbl">{on ? 'Enabled' : 'Disabled'}</span>
    </span>
  )
}

export default function Notifications({
  system,
  badge,
  onToggleSystem,
  onToggleBadge
}: NotificationsProps): ReactElement {
  return (
    <Pane no="07" title="Notifications" sub="Choose how AxiVale alerts you to new activity.">
      <Card title="Alerts">
        <Field
          label="System notifications"
          help="Show a desktop notification when a response finishes while AxiVale is in the background."
        >
          <Toggle on={system} onChange={onToggleSystem} />
        </Field>
        <Field
          label="App badges"
          help="Show an unread count on the app icon when new responses arrive."
        >
          <Toggle on={badge} onChange={onToggleBadge} />
        </Field>
      </Card>
    </Pane>
  )
}
