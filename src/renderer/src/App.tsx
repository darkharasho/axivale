import { useEffect, useRef, useState, type ReactElement } from 'react'
import './theme.css'
import { applyEvent, type AgentEvent, type Turn } from './state'
import Masthead, { type Section } from './components/Masthead'
import Builds from './components/panels/Builds'
import Comps from './components/panels/Comps'
import Roster from './components/panels/Roster'
import Bureau from './components/panels/Bureau'
import { LeftRail, RightRail } from './components/Rails'
import Article from './components/Article'
import InputBar from './components/InputBar'
import ConfirmDialog, { type ConfirmReq } from './components/ConfirmDialog'
import Settings from './components/Settings'

const SECTION_TITLES: Record<Section, string> = {
  dispatches: 'Dispatches',
  builds: 'Builds',
  comps: 'Compositions',
  roster: 'Roster',
  bureau: 'Bureau',
  settings: 'Settings'
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

export default function App(): ReactElement {
  const [turns, setTurns] = useState<Turn[]>([])
  const [section, setSection] = useState<Section>('dispatches')
  const [running, setRunning] = useState(false)
  const [confirmQueue, setConfirmQueue] = useState<ConfirmReq[]>([])

  // status surfaced in masthead / rails
  const [axiConnected, setAxiConnected] = useState(false)
  const [guildName, setGuildName] = useState<string | null>(null)
  const [gw2AccountName, setGw2AccountName] = useState<string | null>(null)
  const [claudeTokenSaved, setClaudeTokenSaved] = useState(false)

  const chatRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  const dateline =
    new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }) + ' · Evening Edition'
  const issueNo = dayOfYear(new Date()) % 100

  async function refreshStatus(): Promise<void> {
    setClaudeTokenSaved(await window.officer.hasSecret('claudeOauthToken'))
    setGw2AccountName(await window.officer.getSetting('gw2AccountName'))
    const chosenGuild = await window.officer.getSetting('guildId')
    try {
      const res = await window.officer.axitoolsStatus()
      setAxiConnected(res.ok)
      if (res.ok && res.guilds) {
        const match = res.guilds.find((g) => String(g.id) === chosenGuild)
        setGuildName(match?.name ?? res.guilds[0]?.name ?? null)
      }
    } catch {
      setAxiConnected(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  // Subscribe once; fold events into the last turn.
  useEffect(() => {
    const offEvent = window.officer.onAgentEvent((raw) => {
      const event = raw as AgentEvent
      setTurns((prev) => {
        // Events before any turn are intentionally dropped; submit() always creates the turn first.
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        const updated = applyEvent(last, event)
        const next = prev.slice(0, -1)
        next.push(updated)
        return next
      })
      if ((raw as AgentEvent).kind === 'done') setRunning(false)
    })
    const offConfirm = window.officer.onConfirmRequest((raw) => {
      setConfirmQueue((prev) => [...prev, raw as ConfirmReq])
    })
    return () => {
      offEvent()
      offConfirm()
    }
  }, [])

  // Auto-scroll on new content.
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  function submit(text: string): void {
    const turn: Turn = {
      id: nextId.current++,
      userText: text,
      agentText: '',
      tools: [],
      done: false,
      error: null,
      filedAt: new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
      })
    }
    setTurns((prev) => [...prev, turn])
    setRunning(true)
    void window.officer.sendMessage(text).catch(() => setRunning(false))
  }

  function respondConfirm(id: string, allowed: boolean): void {
    window.officer.respondConfirm(id, allowed)
    setConfirmQueue((prev) => prev.slice(1))
  }

  const memberCount: number | null = null
  const buildsCount: number | null = null

  return (
    <>
      <Masthead
        issueNo={issueNo}
        axiConnected={axiConnected}
        gw2AccountName={gw2AccountName}
        guildName={guildName}
        guildTag={null}
        memberCount={memberCount}
        claudeTokenSaved={claudeTokenSaved}
        section={section}
        onSection={setSection}
      />
      <div className="sheet">
        <LeftRail memberCount={memberCount} buildsCount={buildsCount} turns={turns} />
        <div className="chatcol">
          <div className="folio">
            <h1>{SECTION_TITLES[section]}</h1>
            <span className="d">{dateline}</span>
          </div>
          {section === 'settings' && <Settings onChanged={refreshStatus} />}
          {section === 'builds' && <Builds />}
          {section === 'comps' && <Comps />}
          {section === 'roster' && <Roster />}
          {section === 'bureau' && <Bureau />}
          {section === 'dispatches' && (
            <div className="chat" ref={chatRef}>
              {turns.length === 0 ? (
                <div className="empty">No dispatches yet — file your orders below.</div>
              ) : (
                turns.map((turn) => <Article key={turn.id} turn={turn} />)
              )}
            </div>
          )}
        </div>
        <RightRail memberCount={memberCount} buildsCount={buildsCount} turns={turns} />
      </div>
      {section === 'dispatches' && <InputBar disabled={running} onSubmit={submit} />}
      {confirmQueue.length > 0 && <ConfirmDialog req={confirmQueue[0]} onRespond={respondConfirm} />}
    </>
  )
}
