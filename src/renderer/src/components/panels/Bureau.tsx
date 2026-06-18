import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { Circle } from 'lucide-react'
import {
  axi,
  ChannelTag,
  errText,
  isOffline,
  Offline,
  textChannels,
  WEEK_FULL,
  ZapButton,
  type Overview
} from './shared'

interface Stream {
  name: string
  platform: string
  channel_display_name?: string
  discord_channel_id: string
  ping_role_id?: string
  is_live?: boolean
  last_live_at?: string
}

interface RssFeed {
  name: string
  url: string
  channel_id: string
  last_entry_published_at?: string
}

interface Alliance {
  channel_id?: string
  guild_id?: string
  guild_name?: string
  server_name?: string
  prediction_day?: string
  prediction_time?: string
  current_day?: string
  current_time?: string
  relink_enabled?: boolean
}

const STREAM_FORM = { name: '', platform: 'twitch', channel_ref: '', discord_channel_id: '', ping_role_id: '' }
const RSS_FORM = { name: '', url: '', channel_id: '' }

export default function Bureau(): ReactElement {
  const [ov, setOv] = useState<Overview | null>(null)
  const [streams, setStreams] = useState<Stream[]>([])
  const [feeds, setFeeds] = useState<RssFeed[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)

  const [streamForm, setStreamForm] = useState(STREAM_FORM)
  const [streamErr, setStreamErr] = useState('')
  const [streamBusy, setStreamBusy] = useState(false)

  const [rssForm, setRssForm] = useState(RSS_FORM)
  const [rssErr, setRssErr] = useState('')
  const [rssBusy, setRssBusy] = useState(false)

  const [alliance, setAlliance] = useState<Alliance>({})
  const [allianceErr, setAllianceErr] = useState('')
  const [allianceStatus, setAllianceStatus] = useState('')
  const [allianceBusy, setAllianceBusy] = useState(false)

  const load = useCallback(async () => {
    const [o, s, r, a] = await Promise.allSettled([
      axi<Overview>('discordOverview'),
      axi<Stream[]>('streamsList'),
      axi<RssFeed[]>('rssList'),
      axi<Alliance>('allianceGet')
    ])
    const reasons = [o, s, r, a].filter((x) => x.status === 'rejected')
    if (reasons.some((x) => isOffline((x as PromiseRejectedResult).reason))) {
      setOffline(true)
      setLoaded(true)
      return
    }
    setOffline(false)
    if (o.status === 'fulfilled') setOv(o.value)
    if (s.status === 'fulfilled') {
      setStreams(s.value)
      setStreamErr('')
    } else setStreamErr(errText(s.reason))
    if (r.status === 'fulfilled') {
      setFeeds(r.value)
      setRssErr('')
    } else setRssErr(errText(r.reason))
    if (a.status === 'fulfilled') {
      setAlliance(a.value ?? {})
      setAllianceErr('')
    } else setAllianceErr(errText(a.reason))
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const channels = textChannels(ov)
  const roles = ov?.roles ?? []

  // — Streams —
  async function addStream(e: FormEvent): Promise<void> {
    e.preventDefault()
    setStreamBusy(true)
    setStreamErr('')
    try {
      await axi('streamSet', streamForm.name.trim(), {
        platform: streamForm.platform,
        channel_ref: streamForm.channel_ref.trim(),
        discord_channel_id: streamForm.discord_channel_id,
        ...(streamForm.ping_role_id ? { ping_role_id: streamForm.ping_role_id } : {})
      })
      setStreamForm(STREAM_FORM)
      await load()
    } catch (err) {
      setStreamErr(errText(err))
    } finally {
      setStreamBusy(false)
    }
  }

  async function removeStream(name: string): Promise<void> {
    try {
      await axi('streamDelete', name)
      await load()
    } catch (e) {
      setStreamErr(errText(e))
    }
  }

  // — RSS —
  async function addRss(e: FormEvent): Promise<void> {
    e.preventDefault()
    setRssBusy(true)
    setRssErr('')
    try {
      await axi('rssSet', rssForm.name.trim(), {
        url: rssForm.url.trim(),
        channel_id: rssForm.channel_id
      })
      setRssForm(RSS_FORM)
      await load()
    } catch (err) {
      setRssErr(errText(err))
    } finally {
      setRssBusy(false)
    }
  }

  async function removeRss(name: string): Promise<void> {
    try {
      await axi('rssDelete', name)
      await load()
    } catch (e) {
      setRssErr(errText(e))
    }
  }

  // — Alliance —
  function setAl(key: keyof Alliance, value: string | boolean): void {
    setAlliance((a) => ({ ...a, [key]: value }))
    setAllianceStatus('')
  }

  async function saveAlliance(): Promise<void> {
    setAllianceBusy(true)
    setAllianceErr('')
    setAllianceStatus('')
    try {
      const saved = await axi<Alliance>('allianceSet', {
        channel_id: alliance.channel_id || undefined,
        guild_id: alliance.guild_id || undefined,
        guild_name: alliance.guild_name || undefined,
        prediction_day: alliance.prediction_day || undefined,
        prediction_time: alliance.prediction_time || undefined,
        current_day: alliance.current_day || undefined,
        current_time: alliance.current_time || undefined,
        relink_enabled: alliance.relink_enabled ?? false
      })
      setAlliance(saved ?? alliance)
      setAllianceStatus(
        `filed · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
      )
    } catch (e) {
      setAllianceErr(errText(e))
    } finally {
      setAllianceBusy(false)
    }
  }

  if (offline) {
    return (
      <div className="settings">
        <Offline />
      </div>
    )
  }

  const channelSelect = (
    value: string,
    onChange: (v: string) => void,
    placeholder = 'choose a channel…'
  ): ReactElement => (
    <select className="sselect" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          #{c.name}
        </option>
      ))}
    </select>
  )

  return (
    <div className="settings">
      <div className="sgroup">
        <h2>Broadcast Desk</h2>
        <p className="shelp">Streamers the bot watches — go-live notices are posted to Discord.</p>
        {streams.length === 0 ? (
          <div className="panel-empty">{loaded ? 'No streams on watch.' : 'Fetching the wire…'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Platform</th>
                <th>Display name</th>
                <th>Posts to</th>
                <th>Status</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s) => (
                <tr key={s.name}>
                  <td className="nm2">{s.name}</td>
                  <td className="mono">{s.platform}</td>
                  <td>{s.channel_display_name || '—'}</td>
                  <td className="mono"><ChannelTag ov={ov} id={s.discord_channel_id} /></td>
                  <td className="mono">
                    {s.is_live ? (
                      <span className="lit">
                        <Circle size={8} fill="currentColor" strokeWidth={0} /> live
                      </span>
                    ) : (
                      <span className="off-air">
                        <Circle size={8} fill="currentColor" strokeWidth={0} /> off-air
                      </span>
                    )}
                  </td>
                  <td className="act">
                    <ZapButton title={`Delete "${s.name}"`} onConfirm={() => void removeStream(s.name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={(e) => void addStream(e)}>
          <div className="fgrid">
            <div>
              <label className="slabel">Name</label>
              <input
                className="sinput"
                value={streamForm.name}
                placeholder="short handle, e.g. moxie"
                onChange={(e) => setStreamForm({ ...streamForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="slabel">Platform</label>
              <select
                className="sselect"
                value={streamForm.platform}
                onChange={(e) => setStreamForm({ ...streamForm, platform: e.target.value })}
              >
                <option value="twitch">twitch</option>
                <option value="youtube">youtube</option>
                <option value="kick">kick</option>
              </select>
            </div>
            <div>
              <label className="slabel">Channel ref</label>
              <input
                className="sinput"
                value={streamForm.channel_ref}
                placeholder="platform channel name or URL"
                onChange={(e) => setStreamForm({ ...streamForm, channel_ref: e.target.value })}
              />
            </div>
            <div>
              <label className="slabel">Post to channel</label>
              {channelSelect(streamForm.discord_channel_id, (v) =>
                setStreamForm({ ...streamForm, discord_channel_id: v })
              )}
            </div>
          </div>
          <label className="slabel">Ping role (optional)</label>
          <select
            className="sselect"
            value={streamForm.ping_role_id}
            onChange={(e) => setStreamForm({ ...streamForm, ping_role_id: e.target.value })}
          >
            <option value="">no ping</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                @{r.name}
              </option>
            ))}
          </select>
          <div className="srow">
            <button
              className="sbtn"
              type="submit"
              disabled={
                streamBusy ||
                !streamForm.name.trim() ||
                !streamForm.channel_ref.trim() ||
                !streamForm.discord_channel_id
              }
            >
              Add stream
            </button>
          </div>
          {streamErr && <div className="sstatus err">{streamErr}</div>}
        </form>
      </div>

      <div className="sgroup">
        <h2>Wire Services</h2>
        <p className="shelp">RSS feeds syndicated into Discord channels as new entries publish.</p>
        {feeds.length === 0 ? (
          <div className="panel-empty">{loaded ? 'No feeds subscribed.' : 'Fetching feeds…'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Posts to</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.name}>
                  <td className="nm2">{f.name}</td>
                  <td className="mono">{f.url}</td>
                  <td className="mono"><ChannelTag ov={ov} id={f.channel_id} /></td>
                  <td className="act">
                    <ZapButton title={`Delete "${f.name}"`} onConfirm={() => void removeRss(f.name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={(e) => void addRss(e)}>
          <div className="fgrid">
            <div>
              <label className="slabel">Name</label>
              <input
                className="sinput"
                value={rssForm.name}
                placeholder="e.g. metabattle"
                onChange={(e) => setRssForm({ ...rssForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="slabel">Post to channel</label>
              {channelSelect(rssForm.channel_id, (v) => setRssForm({ ...rssForm, channel_id: v }))}
            </div>
          </div>
          <label className="slabel">Feed URL</label>
          <input
            className="sinput"
            value={rssForm.url}
            placeholder="https://…/feed.xml"
            onChange={(e) => setRssForm({ ...rssForm, url: e.target.value })}
          />
          <div className="srow">
            <button
              className="sbtn"
              type="submit"
              disabled={rssBusy || !rssForm.name.trim() || !rssForm.url.trim() || !rssForm.channel_id}
            >
              Add feed
            </button>
          </div>
          {rssErr && <div className="sstatus err">{rssErr}</div>}
        </form>
      </div>

      <div className="sgroup">
        <h2>Alliance Affairs</h2>
        <p className="shelp">
          World Restructuring notices — where predictions and confirmed links get posted.
        </p>
        <div className="fgrid">
          <div>
            <label className="slabel">Announcement channel</label>
            {channelSelect(alliance.channel_id ?? '', (v) => setAl('channel_id', v))}
          </div>
          <div>
            <label className="slabel">Alliance guild name</label>
            <input
              className="sinput"
              value={alliance.guild_name ?? ''}
              placeholder="e.g. Eternal Wardens"
              onChange={(e) => setAl('guild_name', e.target.value)}
            />
          </div>
          <div>
            <label className="slabel">Alliance guild ID</label>
            <input
              className="sinput"
              value={alliance.guild_id ?? ''}
              placeholder="GW2 guild id"
              onChange={(e) => setAl('guild_id', e.target.value)}
            />
          </div>
          <div />
          <div>
            <label className="slabel">Prediction day</label>
            <select
              className="sselect"
              value={alliance.prediction_day ?? ''}
              onChange={(e) => setAl('prediction_day', e.target.value)}
            >
              <option value="">—</option>
              {WEEK_FULL.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="slabel">Prediction time</label>
            <input
              className="sinput"
              type="time"
              value={alliance.prediction_time ?? ''}
              onChange={(e) => setAl('prediction_time', e.target.value)}
            />
          </div>
          <div>
            <label className="slabel">Current-link day</label>
            <select
              className="sselect"
              value={alliance.current_day ?? ''}
              onChange={(e) => setAl('current_day', e.target.value)}
            >
              <option value="">—</option>
              {WEEK_FULL.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="slabel">Current-link time</label>
            <input
              className="sinput"
              type="time"
              value={alliance.current_time ?? ''}
              onChange={(e) => setAl('current_time', e.target.value)}
            />
          </div>
        </div>
        <label className="slabel">Relink notices</label>
        <div className="picker row">
          <button
            type="button"
            className={`pi${alliance.relink_enabled ? ' sel' : ''}`}
            onClick={() => setAl('relink_enabled', true)}
          >
            On
          </button>
          <button
            type="button"
            className={`pi${alliance.relink_enabled ? '' : ' sel'}`}
            onClick={() => setAl('relink_enabled', false)}
          >
            Off
          </button>
        </div>
        <div className="srow" style={{ marginTop: 14 }}>
          <button className="sbtn" disabled={allianceBusy} onClick={() => void saveAlliance()}>
            File alliance notice
          </button>
        </div>
        {allianceStatus && <div className="sstatus ok">{allianceStatus}</div>}
        {allianceErr && <div className="sstatus err">{allianceErr}</div>}
      </div>
    </div>
  )
}
