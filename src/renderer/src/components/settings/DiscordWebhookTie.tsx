import { useEffect, useState, type ReactElement } from 'react'
import { Card, type KeyLabel } from '../panelui'

interface WebhookRef {
  id: string
  name: string
}
type Tie = Record<string, { comp: string[]; build: string[] }>

/**
 * Per-server Discord webhook routing. Each saved AxiVale key (Discord server) is
 * tied to AxiForge comp/build webhook(s); a comp/build share posts to the tied
 * webhooks of the server the agent targeted. Self-contained: loads AxiForge's
 * webhook list + the `discordWebhookTie` setting and persists changes itself.
 */
export default function DiscordWebhookTie({ keys }: { keys: KeyLabel[] }): ReactElement | null {
  const [webhooks, setWebhooks] = useState<{ comp: WebhookRef[]; build: WebhookRef[] } | null>(null)
  const [tie, setTie] = useState<Tie>({})

  useEffect(() => {
    void (async () => {
      setWebhooks(
        await window.officer.listDiscordWebhooks().catch(() => ({ comp: [], build: [] }))
      )
      try {
        setTie(JSON.parse((await window.officer.getSetting('discordWebhookTie')) ?? '{}') as Tie)
      } catch {
        setTie({})
      }
    })()
  }, [])

  if (!keys.length) return null

  const persist = (next: Tie): void => {
    setTie(next)
    void window.officer.setSetting('discordWebhookTie', JSON.stringify(next))
  }

  const toggle = (label: string, kind: 'comp' | 'build', id: string): void => {
    const entry = tie[label] ?? { comp: [], build: [] }
    const set = new Set(entry[kind])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    persist({ ...tie, [label]: { ...entry, [kind]: [...set] } })
  }

  const noHooks = webhooks != null && !webhooks.comp.length && !webhooks.build.length

  return (
    <Card title="Discord webhook routing">
      {webhooks == null ? (
        <div className="perm">Loading AxiForge webhooks…</div>
      ) : noHooks ? (
        <div className="perm">
          No AxiForge webhooks found. Open AxiForge, add a comp/build webhook in its Settings, then
          reopen this panel.
        </div>
      ) : (
        <div className="webhook-tie">
          {keys.map((k) => {
            const entry = tie[k.label] ?? { comp: [], build: [] }
            return (
              <div className="wt-server" key={k.label}>
                <div className="wt-server-name">{k.meta?.name ?? k.label}</div>
                <WebhookGroup
                  label="Comp"
                  hooks={webhooks.comp}
                  selected={entry.comp}
                  onToggle={(id) => toggle(k.label, 'comp', id)}
                />
                <WebhookGroup
                  label="Build"
                  hooks={webhooks.build}
                  selected={entry.build}
                  onToggle={(id) => toggle(k.label, 'build', id)}
                />
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function WebhookGroup({
  label,
  hooks,
  selected,
  onToggle
}: {
  label: string
  hooks: WebhookRef[]
  selected: string[]
  onToggle: (id: string) => void
}): ReactElement {
  return (
    <div className="wt-group">
      <div className="wt-group-label">{label}</div>
      {hooks.length === 0 ? (
        <div className="wt-empty">none configured</div>
      ) : (
        hooks.map((h) => (
          <label className="wt-opt" key={h.id}>
            <input
              type="checkbox"
              checked={selected.includes(h.id)}
              onChange={() => onToggle(h.id)}
            />
            {h.name}
          </label>
        ))
      )}
    </div>
  )
}
