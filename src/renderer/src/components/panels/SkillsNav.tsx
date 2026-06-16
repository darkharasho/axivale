import type { ReactElement } from 'react'
import type { SkillsController } from './useSkills'

/** Left-rail master list for the Skills tab (replaces Editions on this section),
 *  mirroring how MetaNav/SettingsNav own the rail for their tabs. */
export default function SkillsNav({ ctl }: { ctl: SkillsController }): ReactElement {
  const { skills, filtered, activeId, creating, draft, query, setQuery, select, newSkill } = ctl
  return (
    <nav className="rail left sk2-rail">
      <div className="sk2-rail-h">
        <span className="sk2-kick">Skills · {skills.length}</span>
        <button className="sk2-new" onClick={newSkill}>
          + New
        </button>
      </div>
      <input
        className="sk2-search"
        placeholder="Filter skills…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="sk2-items">
        {creating && (
          <li className="sk2-item on">
            <span className="led off" />
            <div className="sk2-item-txt">
              <div className="sk2-item-nm">{draft.name.trim() || 'Untitled skill'}</div>
              <div className="sk2-item-wh">new · unsaved</div>
            </div>
          </li>
        )}
        {filtered.map((s) => (
          <li
            key={s.id}
            className={`sk2-item${s.enabled ? '' : ' off'}${
              !creating && s.id === activeId ? ' on' : ''
            }`}
            onClick={() => select(s)}
          >
            <span className={`led${s.enabled ? '' : ' off'}`} />
            <div className="sk2-item-txt">
              <div className="sk2-item-nm">{s.name}</div>
              <div className="sk2-item-wh">{s.whenToUse}</div>
            </div>
          </li>
        ))}
        {filtered.length === 0 && !creating && (
          <li className="sk2-empty">{skills.length === 0 ? 'No skills yet.' : 'No matches.'}</li>
        )}
      </ul>
    </nav>
  )
}
