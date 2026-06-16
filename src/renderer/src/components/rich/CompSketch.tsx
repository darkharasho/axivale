import type { ReactElement } from 'react'
import type { DisplayPayload } from '../../state'
import { classIconUrl } from '../panels/classIcons'

type CompSketchSpec = Extract<DisplayPayload, { kind: 'comp-sketch' }>['data']

/** Class icon as <img>, or a neutral placeholder when the spec name doesn't
 *  resolve (e.g. a typo or a spec we have no icon for). */
function Icon({ spec, className }: { spec: string; className?: string }): ReactElement {
  const url = classIconUrl(spec)
  const cls = `cs-icon ${className ?? ''}`.trim()
  if (!url) return <span className={`${cls} cs-icon--missing`} aria-hidden="true" />
  return <img className={cls} src={url} alt={spec} />
}

/**
 * Visual composition: an optional squad grid (icon tiles, subgroups as columns)
 * over a per-build detail list. Driven by the `comp-sketch` display the
 * comp_sketch tool emits, so the agent never has to render a comp as a table.
 */
export default function CompSketch({ spec }: { spec: CompSketchSpec }): ReactElement {
  const { title, subtitle, subgroups, builds } = spec
  return (
    <div className="rich comp-sketch">
      {(title || subtitle) && (
        <div className="cs-head">
          {title && <span className="cs-title">{title}</span>}
          {subtitle && <span className="cs-sub">{subtitle}</span>}
        </div>
      )}
      {subgroups && subgroups.length > 0 && (
        <div className="cs-grid">
          {subgroups.map((party, i) => (
            <div className="cs-col" key={i}>
              <div className="cs-col-h">{i + 1}</div>
              {party.map((slot, j) => (
                <div className={`cs-tile cs-role--${slot.role}`} key={j} title={`${slot.spec} · ${slot.role}`}>
                  <Icon spec={slot.spec} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="cs-builds">
        {builds.map((b, i) => (
          <div className={`cs-build cs-role--${b.role}`} key={i}>
            <Icon spec={b.spec} className="cs-icon--lg" />
            <div className="cs-build-main">
              <div className="cs-build-top">
                <span className="cs-build-name">{b.spec}</span>
                <span className="cs-role-pill">{b.role}</span>
                {b.count != null && <span className="cs-build-x">×{b.count}</span>}
              </div>
              {b.weapons && <div className="cs-build-weap">{b.weapons}</div>}
              {b.note && <div className="cs-build-note">{b.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
