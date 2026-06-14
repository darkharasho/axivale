import { useEffect, useState, type ReactElement } from 'react'
import type { RendererSkill } from '../../../../preload/index.d'

export default function Skills(): ReactElement {
  const [skills, setSkills] = useState<RendererSkill[]>([])
  const [name, setName] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [instructions, setInstructions] = useState('')

  async function refresh(): Promise<void> {
    setSkills(await window.officer.skillsList())
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function add(): Promise<void> {
    if (!name.trim() || !whenToUse.trim() || !instructions.trim()) return
    await window.officer.skillsCreate({
      name: name.trim(),
      whenToUse: whenToUse.trim(),
      instructions: instructions.trim()
    })
    setName('')
    setWhenToUse('')
    setInstructions('')
    await refresh()
  }

  async function toggle(s: RendererSkill): Promise<void> {
    await window.officer.skillsUpdate(s.id, { enabled: !s.enabled })
    await refresh()
  }

  async function remove(s: RendererSkill): Promise<void> {
    if (!window.confirm(`Delete the "${s.name}" skill?`)) return
    await window.officer.skillsDelete(s.id)
    await refresh()
  }

  return (
    <div className="settings skills-panel">
      <div className="sgroup">
        <h2>New skill</h2>
        <p className="shelp">
          A skill is a reusable recipe. The agent follows it when a request matches
          “when to use” — or when you pick it explicitly.
        </p>
        <input
          className="sinput sk-in"
          placeholder="Name (e.g. Raid Recap)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="sinput sk-in"
          placeholder="When to use (e.g. summarizing how a raid night went)"
          value={whenToUse}
          onChange={(e) => setWhenToUse(e.target.value)}
        />
        <textarea
          className="sinput sk-in sk-area"
          placeholder="Instructions — what to pull, which tools, how to structure the reply"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="srow">
          <button className="sbtn" onClick={() => void add()}>
            Add skill
          </button>
        </div>
      </div>

      <div className="sgroup">
        <h2>Your skills</h2>
        {skills.length === 0 ? (
          <div className="panel-empty">No skills yet.</div>
        ) : (
          <ul className="sk-list">
            {skills.map((s) => (
              <li key={s.id} className={`sk-row${s.enabled ? '' : ' off'}`}>
                <div className="sk-meta">
                  <span className="sk-name">{s.name}</span>
                  <span className="sk-when">{s.whenToUse}</span>
                </div>
                <div className="sk-acts">
                  <button className="sbtn" onClick={() => void toggle(s)}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="sbtn" onClick={() => void remove(s)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
