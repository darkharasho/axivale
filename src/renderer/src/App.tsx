import { useEffect, useRef, useState, type ReactElement } from 'react'
import './theme.css'
import { applyEvent, type AgentEvent, type Turn } from './state'
import Masthead, { type Section } from './components/Masthead'
import Builds from './components/panels/Builds'
import Comps from './components/panels/Comps'
import Roster from './components/panels/Roster'
import Bureau from './components/panels/Bureau'
import { RightRail } from './components/Rails'
import Editions, { type EditionItem } from './components/Editions'
import Article from './components/Article'
import ShareDialog, { type ShareState } from './components/ShareDialog'
import InputBar from './components/InputBar'
import ConfirmDialog, { type ConfirmReq } from './components/ConfirmDialog'
import Settings from './components/Settings'
import UpdateBanner from './components/UpdateBanner'
import type { RendererConversation } from '../../preload/index.d'

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

const TURNS_KEY = 'axivale.turns'

// Legacy single conversation persisted under localStorage; migrated once.
function legacyTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(TURNS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Turn[]
    return Array.isArray(parsed) ? parsed.map((t) => (t.done ? t : { ...t, done: true })) : []
  } catch {
    return []
  }
}

function completedTurnCount(turns: Turn[]): number {
  return turns.filter((t) => t.done).length
}

function nextTurnId(turns: Turn[]): number {
  return turns.reduce((m, t) => Math.max(m, t.id), 0) + 1
}

function lastTurnRunning(turns: Turn[] | undefined): boolean {
  if (!turns || turns.length === 0) return false
  return !turns[turns.length - 1].done
}

const AWAY_ERROR = 'This dispatch finished while you were away — reopen to continue.'

// A disk-loaded transcript may contain a stub turn left mid-stream by a prior
// session. With no live in-memory version, treat it as finished-while-away.
function sanitizeLoadedTurns(turns: Turn[]): Turn[] {
  return turns.map((t) => (t.done ? t : { ...t, done: true, error: t.error ?? AWAY_ERROR }))
}

export default function App(): ReactElement {
  const [conversations, setConversations] = useState<RendererConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Per-conversation transcripts. The center column shows turnsByConv[activeId].
  const [turnsByConv, setTurnsByConv] = useState<Record<string, Turn[]>>({})
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [section, setSection] = useState<Section>('dispatches')
  const [running, setRunning] = useState(false)
  const [bridgeProgress, setBridgeProgress] = useState<string | null>(null)
  const [confirmQueue, setConfirmQueue] = useState<ConfirmReq[]>([])
  const [shareState, setShareState] = useState<ShareState>({ status: 'idle' })

  async function shareResponse(conversationId: string, turnId: number): Promise<void> {
    setShareState({ status: 'publishing' })
    const res = await window.officer.shareResponse(conversationId, turnId)
    setShareState(res.ok ? { status: 'done', url: res.url } : { status: 'error', error: res.error })
  }

  async function shareConversation(conversationId: string): Promise<void> {
    setShareState({ status: 'publishing' })
    const res = await window.officer.shareConversation(conversationId)
    setShareState(res.ok ? { status: 'done', url: res.url } : { status: 'error', error: res.error })
  }

  const turns = (activeId && turnsByConv[activeId]) || []
  // Mirror of turnsByConv for handlers that need the current value without
  // re-subscribing (event handler, openConversation running-check).
  const turnsByConvRef = useRef(turnsByConv)
  turnsByConvRef.current = turnsByConv

  // status surfaced in masthead / rails
  const [axiConnected, setAxiConnected] = useState(false)
  const [guildName, setGuildName] = useState<string | null>(null)
  const [gw2AccountName, setGw2AccountName] = useState<string | null>(null)
  const [claudeTokenSaved, setClaudeTokenSaved] = useState(false)
  const [providerNote, setProviderNote] = useState<string | null>(null)

  const chatRef = useRef<HTMLDivElement>(null)
  // The active id seen by event handlers (avoids stale closures in subscriptions).
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  // Per-conversation debounce handles for save-turns, keyed by conversationId.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Debounced, per-conversation persistence — never cross-writes between convs.
  function scheduleSave(id: string, convTurns: Turn[]): void {
    const timers = saveTimers.current
    if (timers[id]) clearTimeout(timers[id])
    timers[id] = setTimeout(() => {
      delete timers[id]
      void window.officer.saveTurns(id, convTurns)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, turns: convTurns, updatedAt: new Date().toISOString() } : c
        )
      )
    }, 300)
  }

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
    try {
      const status = await window.officer.providerStatus()
      setProviderNote(status.ready ? status.note : (status.note ?? 'Configure a provider in Settings.'))
    } catch {
      setProviderNote(null)
    }
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

  async function openConversation(id: string, knownList?: RendererConversation[]): Promise<void> {
    const conv = await window.officer.getConversation(id)
    if (!conv) return
    setActiveId(id)
    // Prefer the live in-memory transcript (may be mid-stream); only load from
    // disk when we have nothing for this conversation yet, sanitizing any stub
    // turn left mid-stream by a prior session.
    const live = turnsByConvRef.current[id] ?? sanitizeLoadedTurns(conv.turns as Turn[])
    setTurnsByConv((prev) => (prev[id] ? prev : { ...prev, [id]: live }))
    void window.officer.setActiveConversation(id)
    // Running reflects the conversation being viewed: live if its last turn is
    // not done.
    setRunning(lastTurnRunning(live))
    const seen = completedTurnCount(conv.turns as Turn[])
    void window.officer.markConversationSeen(id, seen)
    setFreshIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    // Reflect the up-to-date seenTurnCount/turns into the cached list.
    const list = knownList ?? conversations
    setConversations(
      list.map((c) => (c.id === id ? { ...c, seenTurnCount: seen, turns: conv.turns } : c))
    )
  }

  // Load conversations on mount; migrate the legacy localStorage transcript once.
  // didInit guards against React StrictMode's double-invoked mount effect: both
  // passes would otherwise race an empty store + legacy turns and create two
  // migrated conversations. The ref is set synchronously before any await.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    void (async () => {
      let list = await window.officer.listConversations()
      const legacy = legacyTurns()
      if (list.length === 0 && legacy.length > 0) {
        const provider = (await window.officer.getSetting('provider')) as
          | RendererConversation['provider']
          | null
        const created = await window.officer.createConversation({
          turns: legacy,
          provider: provider ?? 'claude',
          seenTurnCount: completedTurnCount(legacy)
        })
        await window.officer.setActiveConversation(created.id)
        localStorage.removeItem(TURNS_KEY)
        list = await window.officer.listConversations()
      }
      setConversations(list)
      const stored = list[0] ?? null
      if (stored) {
        await openConversation(stored.id, list)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe once; fold EVERY event into its own conversation's transcript so
  // backgrounded turns finish in place. Uses refs to avoid stale closures.
  useEffect(() => {
    const offEvent = window.officer.onAgentEvent((raw) => {
      const event = raw as AgentEvent & { conversationId?: string }
      const convId = event.conversationId ?? activeIdRef.current
      if (!convId) return
      const isActive = convId === activeIdRef.current

      setTurnsByConv((prev) => {
        const convTurns = prev[convId]
        if (!convTurns || convTurns.length === 0) return prev
        const last = convTurns[convTurns.length - 1]
        const updated = [...convTurns.slice(0, -1), applyEvent(last, event)]
        // Persist this conversation's transcript (debounced, keyed by convId).
        scheduleSave(convId, updated)
        return { ...prev, [convId]: updated }
      })

      if (event.kind === 'done') {
        if (isActive) {
          setRunning(false)
          setBridgeProgress(null)
        } else {
          // Background conversation finished — flag it fresh, refresh the list.
          setFreshIds((p) => new Set(p).add(convId))
          void window.officer.listConversations().then(setConversations)
        }
      }
    })
    const offConfirm = window.officer.onConfirmRequest((raw) => {
      setConfirmQueue((prev) => [...prev, raw as ConfirmReq])
    })
    const offProgress = window.officer.onAxibridgeProgress((raw) => {
      setBridgeProgress(raw as string)
    })
    return () => {
      offEvent()
      offConfirm()
      offProgress()
    }
  }, [])

  // Auto-scroll on new content.
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  // Clear any pending debounced saves on unmount.
  useEffect(() => {
    const timers = saveTimers.current
    return () => {
      for (const id of Object.keys(timers)) clearTimeout(timers[id])
    }
  }, [])

  async function newConversation(): Promise<void> {
    const provider = (await window.officer.getSetting('provider')) as
      | RendererConversation['provider']
      | null
    const created = await window.officer.createConversation({ provider: provider ?? 'claude' })
    const list = await window.officer.listConversations()
    setConversations(list)
    setActiveId(created.id)
    setTurnsByConv((prev) => ({ ...prev, [created.id]: [] }))
    setRunning(false)
    setConfirmQueue([])
    void window.officer.setActiveConversation(created.id)
  }

  function stopTurn(): void {
    if (activeId) void window.officer.cancelTurn(activeId)
    setConfirmQueue([])
  }

  function submit(text: string): void {
    if (!activeId) return
    const id = activeId
    setTurnsByConv((prev) => {
      const convTurns = prev[id] ?? []
      const turn: Turn = {
        id: nextTurnId(convTurns),
        userText: text,
        agentText: '',
        tools: [],
        done: false,
        error: null,
        filedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      }
      const updated = [...convTurns, turn]
      scheduleSave(id, updated)
      return { ...prev, [id]: updated }
    })
    setRunning(true)
    setBridgeProgress(null)
    void window.officer.sendMessage(id, text).catch(() => setRunning(false))
  }

  function respondConfirm(id: string, allowed: boolean): void {
    window.officer.respondConfirm(id, allowed)
    setConfirmQueue((prev) => prev.slice(1))
  }

  const editionItems: EditionItem[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    turns: c.turns as Turn[],
    dispatchCount: (c.turns as Turn[]).filter((t) => t.userText.trim()).length,
    fresh: freshIds.has(c.id)
  }))

  const memberCount: number | null = null
  const buildsCount: number | null = null

  return (
    <>
      <UpdateBanner />
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
        onSwitched={refreshStatus}
      />
      <div className="sheet">
        <Editions
          items={editionItems}
          activeId={activeId}
          onSelect={(id) => void openConversation(id)}
          onNew={() => void newConversation()}
          onRename={(id, title) => {
            void window.officer.renameConversation(id, title)
            setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
          }}
          onShare={(id) => void shareConversation(id)}
          onDelete={(id) => {
            void window.officer.deleteConversation(id).then(async () => {
              const list = await window.officer.listConversations()
              setConversations(list)
              if (saveTimers.current[id]) {
                clearTimeout(saveTimers.current[id])
                delete saveTimers.current[id]
              }
              setTurnsByConv((prev) => {
                if (!(id in prev)) return prev
                const next = { ...prev }
                delete next[id]
                return next
              })
              if (id === activeId) {
                const fallback = list[0]
                if (fallback) await openConversation(fallback.id, list)
                else await newConversation()
              }
            })
          }}
        />
        <div className="chatcol">
          <div className="folio">
            <h1>{SECTION_TITLES[section]}</h1>
            <span className="d">{dateline}</span>
          </div>
          {section === 'settings' && (
            <Settings onChanged={refreshStatus} onProviderChanged={() => void newConversation()} />
          )}
          {section === 'builds' && <Builds />}
          {section === 'comps' && <Comps />}
          {section === 'roster' && <Roster />}
          {section === 'bureau' && <Bureau />}
          {section === 'dispatches' && (
            <div className="chat" ref={chatRef}>
              {turns.length === 0 ? (
                <div className="empty">
                  No dispatches yet — file your orders below.
                  {providerNote && (
                    <>
                      <br />
                      {providerNote}{' '}
                      <button className="folio-act" onClick={() => setSection('settings')}>
                        Open Settings
                      </button>
                    </>
                  )}
                </div>
              ) : (
                turns.map((turn) => (
                  <Article
                    key={turn.id}
                    turn={turn}
                    conversationId={activeId}
                    onShare={(cid, tid) => void shareResponse(cid, tid)}
                  />
                ))
              )}
            </div>
          )}
        </div>
        <RightRail memberCount={memberCount} buildsCount={buildsCount} turns={turns} />
      </div>
      {section === 'dispatches' && running && bridgeProgress && (
        <div className="bridge-progress">{bridgeProgress}</div>
      )}
      {section === 'dispatches' && (
        <InputBar disabled={running} onSubmit={submit} onStop={stopTurn} />
      )}
      {confirmQueue.length > 0 && <ConfirmDialog req={confirmQueue[0]} onRespond={respondConfirm} />}
      <ShareDialog state={shareState} onClose={() => setShareState({ status: 'idle' })} />
    </>
  )
}
