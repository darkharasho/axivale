import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { axi, errText, isOffline, Offline, ZapButton } from './shared'

interface Build {
  build_id: string
  name: string
  profession: string
  specialization?: string
  url?: string
  chat_code: string
  description?: string
}

const EMPTY_FORM = {
  name: '',
  profession: '',
  specialization: '',
  chat_code: '',
  url: '',
  description: ''
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

  const load = useCallback(async () => {
    try {
      setBuilds(await axi<Build[]>('listBuilds'))
      setOffline(false)
      setListErr('')
    } catch (e) {
      if (isOffline(e)) setOffline(true)
      else setListErr(errText(e))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function field(key: keyof typeof EMPTY_FORM) {
    return (e: { target: { value: string } }): void => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function startEdit(b: Build): void {
    setEditing(b.build_id)
    setForm({
      name: b.name,
      profession: b.profession,
      specialization: b.specialization ?? '',
      chat_code: b.chat_code,
      url: b.url ?? '',
      description: b.description ?? ''
    })
    setFormErr('')
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
    const patch = {
      name: form.name.trim(),
      profession: form.profession.trim(),
      chat_code: form.chat_code.trim(),
      specialization: form.specialization.trim() || undefined,
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

  return (
    <div className="settings">
      <div className="sgroup">
        <h2>The Build Ledger</h2>
        <p className="shelp">
          Approved fits on record with the guild. Chat codes paste straight into the game client.
        </p>
        {builds.length === 0 ? (
          <div className="panel-empty">{loaded ? 'Nothing on file.' : 'Fetching the ledger…'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Profession</th>
                <th>Chat code</th>
                <th>Description</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {builds.map((b) => (
                <tr key={b.build_id}>
                  <td className="nm2">{b.name}</td>
                  <td>
                    {b.profession}
                    {b.specialization ? ` · ${b.specialization}` : ''}
                  </td>
                  <td className="mono">{b.chat_code}</td>
                  <td>{b.description || '—'}</td>
                  <td className="act">
                    <button className="rowbtn" onClick={() => startEdit(b)}>
                      edit
                    </button>
                    <ZapButton title={`Delete "${b.name}"`} onConfirm={() => void remove(b.build_id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {listErr && <div className="sstatus err">{listErr}</div>}
      </div>

      <div className="sgroup">
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
              <label className="slabel">Profession</label>
              <input
                className="sinput"
                value={form.profession}
                placeholder="e.g. Guardian"
                onChange={field('profession')}
              />
            </div>
            <div>
              <label className="slabel">Specialization</label>
              <input
                className="sinput"
                value={form.specialization}
                placeholder="optional, e.g. Firebrand"
                onChange={field('specialization')}
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
              disabled={busy || !form.name.trim() || !form.profession.trim() || !form.chat_code.trim()}
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
