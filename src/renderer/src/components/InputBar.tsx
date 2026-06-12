import { useState, type ReactElement, type KeyboardEvent } from 'react'

export interface InputBarProps {
  disabled: boolean
  onSubmit: (text: string) => void
  onStop: () => void
}

export default function InputBar({ disabled, onSubmit, onStop }: InputBarProps): ReactElement {
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

  return (
    <div className="inputzone">
      <div className="inputbar">
        <div className="inwrap">
          <span className="prompt">&gt;</span>
          <input
            className="field"
            value={value}
            disabled={disabled}
            placeholder="File your orders…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
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
