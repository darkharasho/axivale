import type { ReactElement } from 'react'
import { Pane, Card, Field } from '../panelui'
import { ACCENTS } from '../../themes/accents'
import { SURFACES } from '../../themes/applyTheme'

export interface AppearanceProps {
  /** The accent id currently in force. */
  accent: string
  onSelect: (id: string) => void
  /** The surface id currently in force: 'axi', 'flat' or 'glass'. */
  surface: string
  onSelectSurface: (id: string) => void
}

export default function Appearance({
  accent,
  onSelect,
  surface,
  onSelectSurface
}: AppearanceProps): ReactElement {
  return (
    <Pane
      no="08"
      title="Appearance"
      sub="The ink this edition is printed in, and the stock it is printed on. Shared with every other axi application."
    >
      <Card title="Accent">
        <Field
          label="Accent colour"
          help="Applies immediately and is remembered between sessions."
        >
          <div className="accent-grid">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="accent-swatch"
                data-accent-id={a.id}
                aria-pressed={a.id === accent}
                aria-label={a.label}
                title={a.label}
                // The swatch has to show the colour it selects, which is the one
                // place in this file a value comes from data rather than a token.
                style={{ '--swatch': a.hex } as React.CSSProperties}
                onClick={() => onSelect(a.id)}
              >
                <span className="accent-swatch__chip" />
                <span className="accent-swatch__name">{a.label}</span>
              </button>
            ))}
          </div>
        </Field>
      </Card>

      <Card title="Surface">
        <Field
          label="Surface"
          help="Axi is the design language itself. Flat softens the block and rounds the corners; Glass makes the panels translucent."
        >
          <div className="surface-picker">
            {SURFACES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`axi-btn axi-btn--sm${s.id === surface ? ' axi-btn--primary' : ''}`}
                data-surface-id={s.id}
                aria-pressed={s.id === surface}
                onClick={() => onSelectSurface(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>
      </Card>
    </Pane>
  )
}
