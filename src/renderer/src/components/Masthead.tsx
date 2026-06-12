import type { ReactElement } from 'react'

export interface MastheadProps {
  issueNo: number
  axiConnected: boolean
  gw2AccountName: string | null
  guildName: string | null
  guildTag: string | null
  memberCount: number | null
  claudeTokenSaved: boolean
  section: 'dispatches' | 'settings'
  onSection: (s: 'dispatches' | 'settings') => void
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
        <button
          className={section === 'dispatches' ? 'on' : ''}
          onClick={() => onSection('dispatches')}
        >
          <span className="no">01</span>Dispatches
        </button>
        <button className="dis" title="Coming in a later edition">
          <span className="no">02</span>Builds
        </button>
        <button className="dis" title="Coming in a later edition">
          <span className="no">03</span>Compositions
        </button>
        <button className="dis" title="Coming in a later edition">
          <span className="no">04</span>Roster
        </button>
        <button
          className={section === 'settings' ? 'on' : ''}
          onClick={() => onSection('settings')}
        >
          <span className="no">05</span>Settings
        </button>
      </div>
    </div>
  )
}
