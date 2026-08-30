import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'

export interface InputBarSkill {
  id: string
  name: string
  enabled: boolean
}

export interface InputBarProps {
  disabled: boolean
  onSubmit: (text: string, skillId: string | null) => void
  onStop: () => void
  skills: InputBarSkill[]
}

/** A skill's in-field handle: lowercase, spaces → dashes (e.g. "Roster Report"
 *  → "roster-report"), so a /token never contains a space and parses cleanly. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

// A "/token" is a slash at the start or after whitespace, then word chars.
const TOKEN_RE = /(^|\s)\/([\w-]+)/g

// arcdps raw combat logs — the only file types the composer accepts a drop of.
const LOG_EXT_RE = /\.(zevtc|evtc(\.zip)?)$/i

export default function InputBar({
  disabled,
  onSubmit,
  onStop,
  skills
}: InputBarProps): ReactElement {
  const [value, setValue] = useState('')
  const [caret, setCaret] = useState(0)
  const [hi, setHi] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // A .zevtc/.evtc dropped onto the composer is registered with the log
  // watcher (so it shows up in the Logs panel too) and its id is seeded into
  // the message so the agent can act on it right away.
  async function handleLogDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find((f) => LOG_EXT_RE.test(f.name))
    if (!file) return
    const path = window.officer.axilogPathForFile(file)
    if (!path) return
    const entry = await window.officer.axilogOpenFile(path)
    setValue((v) => {
      const seed = `log ${entry.logId} (${entry.mapFolder})`
      return v.trim() ? `${v.trim()} ${seed}` : seed
    })
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!Array.from(e.dataTransfer.items ?? []).some((it) => it.kind === 'file')) return
    e.preventDefault()
    setDragOver(true)
  }

  // Grow the textarea to fit its content (up to the CSS max-height, past which it
  // scrolls), so multi-line orders are composed in full instead of one scrolling
  // line. Runs after every value change.
  function autoGrow(): void {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(autoGrow, [value])

  // Type-to-focus: rather than grabbing focus automatically, pull focus into the
  // composer only when the user actually starts typing — a plain printable
  // keystroke (no Ctrl/Meta/Alt, so keyboard shortcuts are excluded) made while
  // no other editable element is focused. The character then falls through into
  // the textarea.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (disabled) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length !== 1) return
      const ta = inputRef.current
      if (!ta || ta === document.activeElement) return
      const act = document.activeElement as HTMLElement | null
      if (act && act !== document.body) {
        const tag = act.tagName
        const editable =
          act.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        if (editable) return
      }
      ta.focus()
      const len = ta.value.length
      try {
        ta.setSelectionRange(len, len)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled])

  const enabled = useMemo(() => skills.filter((s) => s.enabled), [skills])
  const bySlug = useMemo(() => {
    const m = new Map<string, InputBarSkill>()
    for (const s of enabled) m.set(slugify(s.name), s)
    return m
  }, [enabled])

  // The slash token the caret is currently inside (if any): "/" preceded by the
  // start or a space, then the partial query, ending exactly at the caret.
  const active = useMemo(() => {
    if (!enabled.length) return null
    const m = /(^|\s)\/([\w-]*)$/.exec(value.slice(0, caret))
    if (!m) return null
    return { start: caret - m[2].length - 1, query: m[2].toLowerCase() }
  }, [value, caret, enabled.length])

  const matches = useMemo(() => {
    if (!active) return []
    const q = active.query
    return enabled
      .filter((s) => !q || slugify(s.name).includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = slugify(a.name).startsWith(q) ? 0 : 1
        const bp = slugify(b.name).startsWith(q) ? 0 : 1
        return ap - bp
      })
      .slice(0, 8)
  }, [active, enabled])

  const open = !!active && matches.length > 0 && !dismissed

  // Reset the highlighted row + un-dismiss whenever the active token changes.
  useEffect(() => {
    setHi(0)
    setDismissed(false)
  }, [active?.start, active?.query])

  function syncCaret(): void {
    const el = inputRef.current
    if (el) setCaret(el.selectionStart ?? el.value.length)
    if (mirrorRef.current && el) mirrorRef.current.scrollTop = el.scrollTop
  }

  function applySkill(s: InputBarSkill): void {
    if (!active) return
    const slug = slugify(s.name)
    const next = `${value.slice(0, active.start)}/${slug} ${value.slice(caret)}`
    const pos = active.start + slug.length + 2
    setValue(next)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  // Pull recognized /skill tokens out of the message: the first valid one
  // becomes the forced skill; all valid tokens are stripped from the prose.
  function extract(raw: string): { text: string; skillId: string | null } {
    let skillId: string | null = null
    const text = raw
      .replace(TOKEN_RE, (whole, pre: string, slug: string) => {
        const s = bySlug.get(slug.toLowerCase())
        if (!s) return whole
        if (!skillId) skillId = s.id
        return pre
      })
      .replace(/\s{2,}/g, ' ')
      .trim()
    return { text, skillId }
  }

  function submit(): void {
    if (disabled) return
    const { text, skillId } = extract(value)
    if (!text) return
    onSubmit(text, skillId)
    setValue('')
    setCaret(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHi((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHi((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applySkill(matches[hi])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    // Enter sends; Shift+Enter (or Ctrl/Cmd+Enter) drops to a new line so
    // multi-line orders can be composed before filing.
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      submit()
    }
  }

  // Mirror text behind the input: identical glyphs, but valid /skill tokens get
  // a highlight box. The input itself paints the real (visible) text on top, so
  // the caret, selection and IME all stay native; the mirror only adds colour.
  const mirror: ReactNode[] = useMemo(() => {
    const out: ReactNode[] = []
    let last = 0
    let k = 0
    let m: RegExpExecArray | null
    TOKEN_RE.lastIndex = 0
    while ((m = TOKEN_RE.exec(value))) {
      const slug = m[2].toLowerCase()
      if (!bySlug.has(slug)) continue
      const tokenStart = m.index + m[1].length
      if (tokenStart > last) out.push(value.slice(last, tokenStart))
      out.push(
        <span className="skill-token" key={k++}>
          {`/${m[2]}`}
        </span>
      )
      last = tokenStart + 1 + m[2].length
    }
    out.push(value.slice(last))
    return out
  }, [value, bySlug])

  return (
    <div className="inputzone">
      <div className="inputbar">
        <div
          className={`inwrap${dragOver ? ' drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void handleLogDrop(e)}
        >
          <span className="prompt">&gt;</span>
          <div className="field-wrap">
            <div className="field-mirror" ref={mirrorRef} aria-hidden="true">
              {mirror}
            </div>
            <textarea
              ref={inputRef}
              className="field"
              value={value}
              disabled={disabled}
              rows={1}
              placeholder={
                enabled.length
                  ? 'File your orders…  ·  type / for a skill  ·  shift+enter for a new line'
                  : 'File your orders…  ·  shift+enter for a new line'
              }
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-controls="skill-typeahead"
              aria-multiline="true"
              onChange={(e) => {
                setValue(e.target.value)
                setCaret(e.target.selectionStart ?? e.target.value.length)
              }}
              onKeyDown={onKeyDown}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onSelect={syncCaret}
              onScroll={syncCaret}
            />
            {open && (
              <div className="skill-typeahead" id="skill-typeahead" role="listbox">
                <div className="skill-ta-head">Skills</div>
                {matches.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={i === hi}
                    className={`skill-opt${i === hi ? ' hi' : ''}`}
                    onMouseEnter={() => setHi(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applySkill(s)
                    }}
                  >
                    <span className="skill-opt-nm">{s.name}</span>
                    <span className="skill-opt-tk">/{slugify(s.name)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
