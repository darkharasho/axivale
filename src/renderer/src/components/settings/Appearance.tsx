import type { ReactElement } from 'react'
import { Pane, Card, Field } from '../panelui'
import { ACCENTS } from '../../themes/accents'

export interface AppearanceProps {
  /** The accent id currently in force. */
  accent: string
  onSelect: (id: string) => void
}

export default function Appearance({ accent, onSelect }: AppearanceProps): ReactElement {
  return (
    <Pane
      no="08"
      title="Appearance"
      sub="The ink this edition is printed in. Shared with every other axi application."
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
    </Pane>
  )
}
