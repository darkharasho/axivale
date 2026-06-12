import type { ReactElement } from 'react'

export type Section = 'dispatches' | 'builds' | 'comps' | 'roster' | 'bureau' | 'settings'

export interface MastheadProps {
  issueNo: number
  axiConnected: boolean
  gw2AccountName: string | null
  guildName: string | null
  guildTag: string | null
  memberCount: number | null
  claudeTokenSaved: boolean
  section: Section
  onSection: (s: Section) => void
}

export default function Masthead(props: MastheadProps): ReactElement {
  const {
    issueNo,
    axiConnected,
    gw2AccountName,
    guildName,
    guildTag,
    memberCount,
    claudeTokenSaved,
    section,
    onSection
  } = props

  const guildDetail = guildName
    ? `${guildTag ? `[${guildTag}]` : ''}${
        memberCount != null ? `${guildTag ? ' · ' : ''}${memberCount} members` : ''
      }`
    : 'no guild'

  return (
    <div className="masthead">
      <div className="mtop">
        <span>Vol. II · No. {issueNo}</span>
        <span className="r">Final Edition · Free to Members</span>
        <span className="winctl">
          <button title="Minimize" onClick={() => window.officer.windowControl('minimize')}>
            —
          </button>
          <button
            title="Maximize"
            onClick={() => window.officer.windowControl('maximize-toggle')}
          >
            □
          </button>
          <button
            className="close"
            title="Close"
            onClick={() => window.officer.windowControl('close')}
          >
            ✕
          </button>
        </span>
      </div>
      <div className="mmain">
        <div className="ear">
          <div>
            <b>AxiTools</b>{' '}
            {axiConnected ? (
              <span className="lit">● connected</span>
            ) : (
              <span className="off-air">● offline</span>
            )}
          </div>
          <div>
            <b>GW2 API</b> {gw2AccountName ?? 'no key'}
          </div>
        </div>
        <div className="title">
          AxiVale<em>.</em>
        </div>
        <div className="ear right">
          <div>
            <b>{guildName ?? 'Guild'}</b> {guildDetail}
          </div>
          <div>
            <b>Claude</b> {claudeTokenSaved ? 'token saved' : 'system login'}
          </div>
        </div>
      </div>
      <div className="mnav">
        {(
          [
            ['01', 'dispatches', 'Dispatches'],
            ['02', 'builds', 'Builds'],
            ['03', 'comps', 'Compositions'],
            ['04', 'roster', 'Roster'],
            ['05', 'bureau', 'Bureau'],
            ['06', 'settings', 'Settings']
          ] as Array<[string, Section, string]>
        ).map(([no, key, label]) => (
          <button key={key} className={section === key ? 'on' : ''} onClick={() => onSection(key)}>
            <span className="no">{no}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
