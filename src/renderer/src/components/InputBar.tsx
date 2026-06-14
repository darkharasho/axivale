import { useState, type ReactElement, type KeyboardEvent } from 'react'

export interface InputBarSkill {
  id: string
  name: string
  enabled: boolean
}

export interface InputBarProps {
  disabled: boolean
  onSubmit: (text: string) => void
  onStop: () => void
  skills: InputBarSkill[]
  forcedSkillId: string | null
  onForceSkill: (id: string | null) => void
}

export default function InputBar({
  disabled,
  onSubmit,
  onStop,
  skills,
  forcedSkillId,
  onForceSkill
}: InputBarProps): ReactElement {
  const [value, setValue] = useState('')

  function submit(): void {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
    setValue('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const enabledSkills = skills.filter((s) => s.enabled)

  return (
    <div className="inputzone">
      <div className="inputbar">
        <div className="inwrap">
          <span className="prompt">&gt;</span>
          {forcedSkillId && (
            <span className="skill-chip">
              {skills.find((s) => s.id === forcedSkillId)?.name ?? 'skill'}
              <button aria-label="Clear skill" onClick={() => onForceSkill(null)}>
                ×
              </button>
            </span>
          )}
          <input
            className="field"
            value={value}
            disabled={disabled}
            placeholder="File your orders…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {enabledSkills.length > 0 && (
            <select
              className="skill-pick"
              value=""
              onChange={(e) => e.target.value && onForceSkill(e.target.value)}
              aria-label="Use a skill"
            >
              <option value="">/ skill…</option>
              {enabledSkills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {disabled ? (
            <button className="filebtn stop" onClick={onStop} title="Stop the current dispatch">
              Stop
            </button>
          ) : (
            <button className="filebtn" onClick={submit}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
