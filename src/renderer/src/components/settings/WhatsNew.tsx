import type { ReactElement } from 'react'

/**
 * In-app release notes — a "Special Edition" broadsheet for the current
 * version, shown in the About pane. Mirrors the newsprint masthead: a flag,
 * a dateline, then headline/blurb entries separated by dashed rules. Edit
 * RELEASE for each release; keep it in step with RELEASE_NOTES.md.
 */

interface ReleaseEntry {
  head: string
  body: string
}

interface Release {
  version: string
  date: string
  lede: string
  entries: ReleaseEntry[]
}

export const RELEASE: Release = {
  version: '1.0.0',
  date: 'June 19, 2026',
  lede: 'AxiVale is generally available — a virtual officer for your Guild Wars 2 guild and Discord.',
  entries: [
    {
      head: 'A virtual officer that runs the guild',
      body: 'File orders in plain English and a Claude agent with real tools does the work. Replies come back as filed articles; every tool call leaves a receipt in the Notices rail.'
    },
    {
      head: 'Guild intelligence',
      body: 'Roster, join history, and activity from the official GW2 API — plus any /v2 endpoint on demand. The Roster desk is searchable when you would rather click than ask.'
    },
    {
      head: 'Builds & compositions',
      body: 'Full CRUD on your AxiTools builds and squad-comp presets and schedules — the app and the bot’s slash commands share one source of truth. Share a comp or build straight to Discord.'
    },
    {
      head: 'Discord management, with a brake pedal',
      body: 'Channels, roles, members, messages, threads, events, and DMs across several servers. Anything destructive stops at a Notice of Destruction you approve first.'
    },
    {
      head: 'The Bureau',
      body: 'Audit-log queries, RSS feeds, stream announcements, WvW alliance settings, and guild→role mappings — the back-office desks, on call.'
    },
    {
      head: 'Built to stay out of your way',
      body: 'Credentials stored encrypted in the OS keychain. Signed, notarized builds for Linux, Windows, and macOS, and the app updates itself from the release feed.'
    }
  ]
}

/** The release broadsheet itself, shared by the About-pane card and the
 *  launch-time modal. */
export function WhatsNewBody(): ReactElement {
  return (
    <div className="wn">
      <div className="wn-flag">
        <span className="wn-kick">Special Edition</span>
        <span className="wn-date">Vol. {RELEASE.version} · {RELEASE.date}</span>
      </div>
      <h3 className="wn-masthead">
        What’s New in AxiVale <em>{RELEASE.version}</em>
      </h3>
      <p className="wn-lede">{RELEASE.lede}</p>
      <div className="wn-entries">
        {RELEASE.entries.map((e) => (
          <article key={e.head} className="wn-entry">
            <h4 className="wn-head">{e.head}</h4>
            <p className="wn-body">{e.body}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

export default function WhatsNew(): ReactElement {
  return <WhatsNewBody />
}
