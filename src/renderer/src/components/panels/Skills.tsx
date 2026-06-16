import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SkillsController } from './useSkills'

function ago(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'saved just now'
  if (mins < 60) return `saved ${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `saved ${hrs}h ago`
  return `saved ${Math.floor(hrs / 24)}d ago`
}

/** Detail editor for the selected skill. The master list lives in SkillsNav
 *  (left rail); both share one SkillsController. */
export default function Skills({ ctl }: { ctl: SkillsController }): ReactElement {
  const { creating, current, draft, setDraft, dirty, valid, tab, setTab, save, toggle, remove } = ctl

  if (!creating && !current) {
    return (
      <div className="sk2-detail sk2-blank">
        <div className="panel-empty">Select a skill, or create a new one.</div>
      </div>
    )
  }

  return (
    <div className="sk2-detail">
      <div className="sk2-head">
        <div className="sk2-head-txt">
          <input
            className="sk2-name-in"
            placeholder="Skill name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="sk2-when-in"
            placeholder="When to use — e.g. summarizing how a raid night went"
            value={draft.whenToUse}
            onChange={(e) => setDraft({ ...draft, whenToUse: e.target.value })}
          />
        </div>
        {current && (
          <button
            className={`sk2-toggle${current.enabled ? '' : ' off'}`}
            onClick={() => void toggle(current)}
          >
            <span className="led" />
            {current.enabled ? 'Enabled' : 'Disabled'}
          </button>
        )}
      </div>

      <div className="sk2-tabs">
        <button className={`sk2-tab${tab === 'edit' ? ' on' : ''}`} onClick={() => setTab('edit')}>
          Edit
        </button>
        <button
          className={`sk2-tab${tab === 'preview' ? ' on' : ''}`}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
        <span className="sk2-tab-note">markdown · instructions</span>
      </div>

      <div className="sk2-body">
        {tab === 'edit' ? (
          <textarea
            className="sk2-editor"
            placeholder="Instructions — what to pull, which tools, how to structure the reply. Markdown supported."
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          />
        ) : (
          <div className="sk2-preview prose">
            {draft.instructions.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.instructions}</ReactMarkdown>
            ) : (
              <p className="sk2-preview-empty">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="sk2-foot">
        <button
          className="sbtn"
          disabled={!valid || (!dirty && !creating)}
          onClick={() => void save()}
        >
          {creating ? 'Add skill' : 'Save changes'}
        </button>
        {current && (
          <button className="sbtn ghost sk2-del" onClick={() => void remove(current)}>
            Delete
          </button>
        )}
        <span className="sk2-foot-note">
          {dirty ? 'unsaved changes' : current ? ago(current.updatedAt) : ''}
        </span>
      </div>
    </div>
  )
}
