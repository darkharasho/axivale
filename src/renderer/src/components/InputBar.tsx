import { useEffect, useRef, useState, type ReactElement, type KeyboardEvent } from 'react'

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
  const [pickOpen, setPickOpen] = useState(false)
  const pickRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPickOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickOpen])

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
            <div className="skill-pick-wrap" ref={pickRef}>
              <button
                type="button"
                className={`skill-pick${pickOpen ? ' open' : ''}`}
                onClick={() => setPickOpen((o) => !o)}
                aria-label="Use a skill"
                aria-haspopup="menu"
                aria-expanded={pickOpen}
              >
                / skill…
              </button>
              {pickOpen && (
                <div className="skill-menu" role="menu">
                  {enabledSkills.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitem"
                      className="skill-opt"
                      onClick={() => {
                        onForceSkill(s.id)
                        setPickOpen(false)
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
