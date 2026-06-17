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
  return (
    <button className={`sk2-toggle${on ? '' : ' off'}`} onClick={() => onChange(!on)}>
      <span className="led" />
      {on ? 'Enabled' : 'Disabled'}
    </button>
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
