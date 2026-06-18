import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement
} from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import {
  axi,
  ClassIcon,
  errText,
  isOffline,
  Offline,
  textChannels,
  ZapButton,
  type Overview
} from './shared'
import { ClassPicker } from './ClassPicker'
import { splitClass } from './classes'

interface Build {
  build_id: string
  name: string
  profession: string
  specialization?: string
  url?: string
  chat_code: string
  description?: string
  filed_at?: string
  created_at?: string
}

const EMPTY_FORM = {
  name: '',
  cls: '',
  chat_code: '',
  url: '',
  description: ''
}

/** Returns a filed-date string if the API supplied one, else null. */
function filedDate(b: Build): string | null {
  const raw = b.filed_at ?? b.created_at
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** A single build "card" with header, body, code bar and footer. */
function BuildCard({
  build,
  onEdit,
  onRemove
}: {
  build: Build
  onEdit: () => void
  onRemove: () => void
}): ReactElement {
  const [clipped, setClipped] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function clip(): void {
    void navigator.clipboard.writeText(build.chat_code)
    window.clearTimeout(timer.current)
    setClipped(true)
    timer.current = window.setTimeout(() => setClipped(false), 2000)
  }

  const filed = filedDate(build)
  return (
    <div className="bcard">
      <div className="bhead">
        <ClassIcon name={build.specialization || build.profession} size={26} />
        <div className="bheadtext">
          <div className="bkick">
            {build.specialization ? `${build.specialization} · ` : ''}
            {build.profession}
          </div>
          <div className="bname">{build.name}</div>
        </div>
      </div>
      <div className="bbody">
        {build.description ? (
          <p>{build.description}</p>
        ) : (
          <p className="bnone">No notes on file.</p>
        )}
      </div>
      <div className="bcode">
        <span className="bcodeval">{build.chat_code}</span>
        <button className={`clipbtn${clipped ? ' done' : ''}`} onClick={clip}>
          {clipped ? (
            <>
              <Check size={11} /> clipped
            </>
          ) : (
            'Clip code'
          )}
        </button>
      </div>
      <div className="bfoot">
        <button className="rowbtn" onClick={onEdit}>
          amend
        </button>
        <ZapButton title={`Delete "${build.name}"`} onConfirm={onRemove} />
        {filed && <span className="bfiled">filed {filed}</span>}
      </div>
    </div>
  )
}

export default function Builds(): ReactElement {
  const [builds, setBuilds] = useState<Build[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [listErr, setListErr] = useState('')
  const [formErr, setFormErr] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // — Desk settings strip —
  const [ov, setOv] = useState<Overview | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [buildChannel, setBuildChannel] = useState('')
  const [chanStatus, setChanStatus] = useState('')
  const [chanErr, setChanErr] = useState('')

  const load = useCallback(async () => {
    const [b, o, c] = await Promise.allSettled([
      axi<Build[]>('listBuilds'),
      axi<Overview>('discordOverview'),
      axi<{ build_channel_id?: string | null }>('configGet')
    ])
    if ([b, o, c].some((x) => x.status === 'rejected' && isOffline((x as PromiseRejectedResult).reason))) {
      setOffline(true)
      setLoaded(true)
      return
    }
    setOffline(false)
    if (b.status === 'fulfilled') {
      setBuilds(b.value)
      setListErr('')
    } else setListErr(errText(b.reason))
    if (o.status === 'fulfilled') setOv(o.value)
    if (c.status === 'fulfilled') setBuildChannel(c.value?.build_channel_id ?? '')
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function field(key: keyof typeof EMPTY_FORM) {
    return (e: { target: { value: string } }): void =>
      setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function startEdit(b: Build): void {
    setEditing(b.build_id)
    setForm({
      name: b.name,
      cls: b.specialization || b.profession,
      chat_code: b.chat_code,
      url: b.url ?? '',
      description: b.description ?? ''
    })
    setFormErr('')
  }

  async function saveBuildChannel(value: string): Promise<void> {
    setBuildChannel(value)
    setChanErr('')
    setChanStatus('')
    try {
      await axi('configPatch', { build_channel_id: value || null })
      setChanStatus('Saved')
    } catch (e) {
      setChanErr(errText(e))
    }
  }

  function cancelEdit(): void {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormErr('')
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setFormErr('')
    const { profession, specialization } = splitClass(form.cls.trim())
    const patch = {
      name: form.name.trim(),
      profession,
      chat_code: form.chat_code.trim(),
      specialization,
      url: form.url.trim() || undefined,
      description: form.description.trim() || undefined
    }
    try {
      if (editing) await axi('updateBuild', editing, patch)
      else await axi('createBuild', patch)
      setForm(EMPTY_FORM)
      setEditing(null)
      await load()
    } catch (err) {
      setFormErr(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await axi('deleteBuild', id)
      if (editing === id) cancelEdit()
      await load()
    } catch (e) {
      setListErr(errText(e))
    }
  }

  if (offline) {
    return (
      <div className="settings">
        <Offline />
      </div>
    )
  }

  // Group builds by profession, preserving first-seen order.
  const groups: { profession: string; items: Build[] }[] = []
  for (const b of builds) {
    let g = groups.find((x) => x.profession === b.profession)
    if (!g) {
      g = { profession: b.profession, items: [] }
      groups.push(g)
    }
    g.items.push(b)
  }

  const buildChannels = textChannels(ov)

  return (
    <div className="settings">
      <div className="deskset">
        <button
          type="button"
          className="deskset-head"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <span className="deskset-tog">
            {settingsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="deskset-lbl">Desk Settings</span>
        </button>
        {settingsOpen && (
          <div className="deskset-body">
            <label className="slabel">Build posting channel</label>
            <select
              className="sselect"
              value={buildChannel}
              onChange={(e) => void saveBuildChannel(e.target.value)}
            >
              <option value="">— none —</option>
              {buildChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            {chanStatus && <div className="sstatus ok">{chanStatus}</div>}
            {chanErr && <div className="sstatus err">{chanErr}</div>}
          </div>
        )}
      </div>

      <p className="shelp deck">
        Approved fits on record with the guild. Chat codes paste straight into the game client.
      </p>

      {builds.length === 0 ? (
        <div className="panel-empty">{loaded ? 'Nothing on file.' : 'Fetching the ledger…'}</div>
      ) : (
        groups.map((g) => (
          <div className="bgroup" key={g.profession}>
            <div className="bgrouphead">
              <ClassIcon name={g.profession} size={16} />
              <span className="bgroupname">{g.profession}</span>
              <span className="bgrouprule" />
              <span className="bgroupcount">
                {g.items.length} on file
              </span>
            </div>
            <div className="bgrid">
              {g.items.map((b) => (
                <BuildCard
                  key={b.build_id}
                  build={b}
                  onEdit={() => startEdit(b)}
                  onRemove={() => void remove(b.build_id)}
                />
              ))}
            </div>
          </div>
        ))
      )}
      {listErr && <div className="sstatus err">{listErr}</div>}

      <div className="sgroup bform">
        <h2>{editing ? 'Amend an Entry' : 'File a Build'}</h2>
        <form onSubmit={(e) => void submit(e)}>
          <div className="fgrid">
            <div>
              <label className="slabel">Name</label>
              <input
                className="sinput"
                value={form.name}
                placeholder="e.g. Heal Firebrand"
                onChange={field('name')}
              />
            </div>
            <div>
              <label className="slabel">Class</label>
              <ClassPicker
                value={form.cls}
                onChange={(v) => setForm((f) => ({ ...f, cls: v }))}
                placeholder="Choose a class…"
              />
            </div>
            <div>
              <label className="slabel">Chat code</label>
              <input
                className="sinput"
                value={form.chat_code}
                placeholder="[&DQE…]"
                onChange={field('chat_code')}
              />
            </div>
          </div>
          <label className="slabel">URL</label>
          <input
            className="sinput"
            value={form.url}
            placeholder="optional build link"
            onChange={field('url')}
          />
          <label className="slabel">Description</label>
          <input
            className="sinput"
            value={form.description}
            placeholder="optional notes for the roster"
            onChange={field('description')}
          />
          <div className="srow">
            <button
              className="sbtn"
              type="submit"
              disabled={busy || !form.name.trim() || !form.cls.trim() || !form.chat_code.trim()}
            >
              {editing ? 'File amendment' : 'File build'}
            </button>
            {editing && (
              <button className="sbtn out" type="button" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
          {formErr && <div className="sstatus err">{formErr}</div>}
        </form>
      </div>
    </div>
  )
}
