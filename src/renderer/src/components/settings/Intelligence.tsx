import type { ReactElement } from 'react'
import { Pane, Card, Field, Segmented, Keyring, type KeyLabel } from './ui'

export type ProviderName = 'claude' | 'gemini' | 'openai' | 'local'

export interface IntelligenceProps {
  provider: ProviderName
  onPickProvider: (p: ProviderName) => void
  // claude
  claudeToken: string
  claudeSaved: boolean
  claudeStatus: string
  model: string
  setClaudeToken: (v: string) => void
  onSaveClaude: () => void
  onPickModel: (p: ProviderName, value: string) => void
  // gemini / openai
  geminiKeys: KeyLabel[]
  openaiKeys: KeyLabel[]
  geminiModel: string
  openaiModel: string
  llmLabel: string
  llmKey: string
  customModel: string
  setLlmLabel: (v: string) => void
  setLlmKey: (v: string) => void
  setCustomModel: (v: string) => void
  onAddLlmKey: (service: 'gemini' | 'openai') => void
  onActivateLlmKey: (service: 'gemini' | 'openai', label: string) => void
  onRemoveLlmKey: (service: 'gemini' | 'openai', label: string) => void
  geminiModels: Array<{ value: string; label: string }>
  openaiModels: Array<{ value: string; label: string }>
  // local
  localEndpoint: string
  localModel: string
  localModels: string[]
  localStatus: { msg: string; ok: boolean } | null
  hw: { totalRamGb: number; recommendedModel: string; modelOptions: string[] } | null
  chosenModel: string
  ollamaBusy: boolean
  ollamaErr: string | null
  ollamaStage: string
  ollamaPct: number | null
  pullingModel: string | null
  setLocalEndpoint: (v: string) => void
  setChosenModel: (v: string) => void
  onSaveLocalEndpoint: () => void
  onStartOllamaSetup: () => void
  onPullModel: (model: string) => void
}

const PROVIDERS: Array<{ value: ProviderName; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'local', label: 'Local' }
]

const CLAUDE_MODELS = [
  { value: '', label: 'Default' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' }
]

export default function Intelligence(p: IntelligenceProps): ReactElement {
  return (
    <Pane
      no="01"
      title="Intelligence"
      sub="The AI provider that writes your dispatches, and the model it uses."
    >
      <Segmented value={p.provider} options={PROVIDERS} onChange={p.onPickProvider} />

      {p.provider === 'claude' && (
        <>
          <Card
            title="Authentication"
            status={{
              msg: p.claudeStatus || (p.claudeSaved ? 'token saved' : 'system login'),
              tone: 'ok'
            }}
          >
            <Field
              label="OAuth token"
              help={
                <>
                  Run <code>claude setup-token</code> in a terminal and paste the result. Leave
                  empty to use this machine&apos;s existing Claude Code login.
                </>
              }
            >
              <input
                className="sfield-input"
                type="password"
                value={p.claudeToken}
                placeholder={p.claudeSaved ? '•••••••• (saved)' : 'paste setup token'}
                onChange={(e) => p.setClaudeToken(e.target.value)}
              />
            </Field>
            <div className="sactions">
              <button className="sbtn" disabled={!p.claudeToken} onClick={p.onSaveClaude}>
                File token
              </button>
            </div>
          </Card>
          <Card title="Model">
            <div className="schips">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.value}
                  className={`schip${p.model === m.value ? ' on' : ''}`}
                  onClick={() => p.onPickModel('claude', m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {(p.provider === 'gemini' || p.provider === 'openai') &&
        ((llmService: 'gemini' | 'openai') => (
        <>
          <Card title="API keys">
            <Keyring
              keys={llmService === 'gemini' ? p.geminiKeys : p.openaiKeys}
              onActivate={(label) => p.onActivateLlmKey(llmService, label)}
              onRemove={(label) => p.onRemoveLlmKey(llmService, label)}
            />
            <Field label="Label">
              <input
                className="sfield-input"
                type="text"
                value={p.llmLabel}
                placeholder="e.g. personal"
                onChange={(e) => p.setLlmLabel(e.target.value)}
              />
            </Field>
            <Field
              label="API key"
              help={
                llmService === 'gemini'
                  ? 'Create a free key at aistudio.google.com → Get API key.'
                  : 'Create a key at platform.openai.com → API keys.'
              }
            >
              <input
                className="sfield-input"
                type="password"
                value={p.llmKey}
                placeholder={
                  llmService === 'gemini' ? 'paste Gemini API key' : 'paste OpenAI API key'
                }
                onChange={(e) => p.setLlmKey(e.target.value)}
              />
            </Field>
            <div className="sactions">
              <button
                className="sbtn"
                disabled={!p.llmKey}
                onClick={() => p.onAddLlmKey(llmService)}
              >
                Add key
              </button>
            </div>
          </Card>
          <Card title="Model">
            <div className="schips">
              {(p.provider === 'gemini' ? p.geminiModels : p.openaiModels).map((m) => {
                const active = p.provider === 'gemini' ? p.geminiModel : p.openaiModel
                return (
                  <button
                    key={m.value}
                    className={`schip${active === m.value ? ' on' : ''}`}
                    onClick={() => p.onPickModel(p.provider, m.value)}
                  >
                    {m.label}
                  </button>
                )
              })}
              {(() => {
                const active = p.provider === 'gemini' ? p.geminiModel : p.openaiModel
                const curated = p.provider === 'gemini' ? p.geminiModels : p.openaiModels
                if (active && !curated.some((m) => m.value === active)) {
                  return <button className="schip on">{active}</button>
                }
                return null
              })()}
            </div>
            <Field label="">
              <input
                className="sfield-input"
                style={{ marginTop: '10px' }}
                type="text"
                value={p.customModel}
                placeholder="or type a custom model id and press Enter"
                onChange={(e) => p.setCustomModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && p.customModel.trim()) {
                    p.onPickModel(p.provider, p.customModel.trim())
                    p.setCustomModel('')
                  }
                }}
              />
            </Field>
          </Card>
        </>
        ))(p.provider)}

      {p.provider === 'local' && (
        <>
          <Card
            title="Server"
            status={p.localStatus ? { msg: p.localStatus.msg, tone: p.localStatus.ok ? 'ok' : 'err' } : undefined}
          >
            <Field label="Endpoint">
              <input
                className="sfield-input"
                type="text"
                value={p.localEndpoint}
                placeholder="http://localhost:11434"
                onChange={(e) => p.setLocalEndpoint(e.target.value)}
              />
            </Field>
            <div className="sactions">
              <button className="sbtn" onClick={p.onSaveLocalEndpoint}>
                Save &amp; probe
              </button>
            </div>
          </Card>

          {p.localModels.length > 0 &&
            (() => {
              const recommended = p.hw?.modelOptions ?? []
              const rows = [
                ...recommended,
                ...p.localModels.filter((m) => !recommended.includes(m))
              ]
              return (
                <Card title="Model">
                  <div className="schips">
                    {rows.map((m) => {
                      const installed = p.localModels.includes(m)
                      const isPulling = p.pullingModel === m
                      return (
                        <button
                          key={m}
                          className={`schip${p.localModel === m ? ' on' : ''}`}
                          disabled={p.ollamaBusy}
                          title={installed ? 'Installed' : 'Not installed — click to download'}
                          onClick={() =>
                            installed ? p.onPickModel('local', m) : p.onPullModel(m)
                          }
                        >
                          {m}{' '}
                          {isPulling
                            ? `· ${p.ollamaPct ?? 0}%`
                            : installed
                              ? '· ✓'
                              : '· ↓'}
                        </button>
                      )
                    })}
                  </div>
                  {p.ollamaErr && <div className="sstatus err">{p.ollamaErr}</div>}
                  <p className="shelp">
                    ✓ installed models are ready. Click a ↓ model to download it. The accented
                    chip is active.
                  </p>
                </Card>
              )
            })()}

          {p.localModels.length === 0 && (
            <Card title="Set up local AI">
              {p.hw && (
                <p className="shelp">
                  Detected {p.hw.totalRamGb} GB RAM — recommended{' '}
                  <strong>{p.hw.recommendedModel}</strong>.
                </p>
              )}
              {p.hw && (
                <div className="schips">
                  {p.hw.modelOptions.map((m) => (
                    <button
                      key={m}
                      className={`schip${p.chosenModel === m ? ' on' : ''}`}
                      disabled={p.ollamaBusy}
                      onClick={() => p.setChosenModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <div className="sactions">
                <button className="sbtn" disabled={p.ollamaBusy} onClick={p.onStartOllamaSetup}>
                  {p.ollamaBusy ? 'Setting up…' : 'Set up local AI (one click)'}
                </button>
              </div>
              {p.ollamaBusy && (
                <div className="ollama-progress">
                  <div className="sstatus">{p.ollamaStage}</div>
                  {p.ollamaPct !== null && <progress max={100} value={p.ollamaPct} />}
                </div>
              )}
              {p.ollamaErr && (
                <div className="sstatus err">
                  {p.ollamaErr}{' '}
                  <button className="sbtn ghost" onClick={p.onStartOllamaSetup}>
                    Retry
                  </button>
                </div>
              )}
              <p className="shelp">
                Installs a private, self-contained Ollama just for AxiVale — no admin rights.
                Local models are slower and less reliable on multi-step tasks than the cloud
                providers.
              </p>
            </Card>
          )}
        </>
      )}
    </Pane>
  )
}
