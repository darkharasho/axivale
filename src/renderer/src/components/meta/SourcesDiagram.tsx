import { Fragment, type ReactElement } from 'react'

/**
 * "How it works" diagram for the Sources overview — a wire-service flow showing
 * the three source groups funnelling into one corpus, then the crawl → index →
 * recall → cited-answer pipeline. Source names mirror the per-mode notes
 * elsewhere in the Meta views; it's explanatory, not data-bound.
 */

interface Group {
  label: string
  chips: string[]
  note: string
}

const GROUPS: Group[] = [
  { label: 'Meta', chips: ['Snowcrows', 'MetaBattle'], note: 'Current build & comp tiers, per game mode.' },
  { label: 'Wiki', chips: ['GW2 Wiki'], note: 'Game mechanics, crafting, achievements, masteries.' },
  {
    label: 'Guides',
    chips: ['Snowcrows', 'GuildJen', 'Hardstuck', 'Discretize'],
    note: 'Long-form encounter & how-to strategy.'
  }
]

interface Step {
  n: string
  title: string
  desc: string
  final?: boolean
}

const STEPS: Step[] = [
  { n: '01 · Crawl', title: 'Fetched on a schedule', desc: 'Each source is re-crawled automatically and stamped with its own publish date.' },
  { n: '02 · Index', title: 'Folded into the index', desc: 'One searchable corpus that knows how fresh each source is.' },
  { n: '03 · Recall', title: 'Pulled when you ask', desc: 'AxiVale retrieves the passages that fit your question.' },
  { n: '04 · Answer', title: 'A cited reply', desc: "Grounded in real sources — and it flags anything that's gone stale.", final: true }
]

export default function SourcesDiagram(): ReactElement {
  return (
    <div className="srcflow">
      <h3 className="srcflow-h">Where the desk gets its facts</h3>
      <p className="srcflow-sub">
        AxiVale never invents builds — it reads a living library of community sources, keeps it
        dated, and quotes from it when you ask.
      </p>

      <div className="sf-row">
        {GROUPS.map((g) => (
          <div key={g.label} className="sf-grp">
            <div className="sf-grp-t">
              <span className="sf-led" />
              {g.label}
            </div>
            <div className="sf-chips">
              {g.chips.map((c) => (
                <span key={c} className="sf-chip">
                  {c}
                </span>
              ))}
            </div>
            <p className="sf-note">{g.note}</p>
          </div>
        ))}
      </div>

      <div className="sf-funnel">
        <span>&#8600;</span>
        <span>&#8595;</span>
        <span>&#8601;</span>
      </div>
      <div className="sf-collect">collected into one corpus</div>

      <div className="sf-pipe">
        {STEPS.map((s, i) => (
          <Fragment key={s.n}>
            <div className={`sf-step${s.final ? ' final' : ''}`}>
              <div className="sf-step-n">{s.n}</div>
              <div className="sf-step-t">{s.title}</div>
              <p className="sf-step-d">{s.desc}</p>
            </div>
            {i < STEPS.length - 1 && <div className="sf-arrow">&#8594;</div>}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
