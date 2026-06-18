import type { ReactElement } from 'react'
import { Check, X } from 'lucide-react'
import { Pane, Card, Field, Keyring, type KeyLabel } from '../panelui'

export interface BridgeRepo {
  owner: string
  repo: string
}
export interface BridgeHealth {
  repo: string
  runs: number
  lastRun: string | null
  cachedReports: number
  lastIndexFetch: number | null
  error: string | null
}

export interface ReportReposProps {
  bridgeRepos: BridgeRepo[]
  bridgeHealth: BridgeHealth[]
  bridgeInput: string
  bridgeStatus: { msg: string; ok: boolean } | null
  bridgeFinding: boolean
  githubKeys: KeyLabel[]
  ghSigningIn: boolean
  ghUserCode: string
  ghCodeCopied: boolean
  ghAuthStatus: { msg: string; ok: boolean } | null
  setBridgeInput: (v: string) => void
  onAddRepo: () => void
  onRemoveRepo: (owner: string, repo: string) => void
  onDiscover: () => void
  onCheckHealth: () => void
  onActivateKey: (label: string) => void
  onRemoveKey: (label: string) => void
  onSignIn: () => void
  onCopyCode: () => void
}

export default function ReportRepos(p: ReportReposProps): ReactElement {
  return (
    <Pane
      no="05"
      title="Report Repos"
      sub="AxiBridge report repositories that feed dispatch data."
    >
      <Card title="Linked repos">
        {p.bridgeRepos.length > 0 && (
          <div className="skeys">
            {p.bridgeRepos.map((r) => {
              const health = p.bridgeHealth.find((h) => h.repo === `${r.owner}/${r.repo}`)
              return (
                <div key={`${r.owner}/${r.repo}`} className="skey">
                  <span className="rad" />
                  {r.owner}/{r.repo}
                  {health && !health.error && (
                    <span className="badge">
                      {health.runs} runs · {health.cachedReports} cached
                    </span>
                  )}
                  {health?.error && <span className="badge">unreachable</span>}
                  <span
                    className="kx"
                    title={`Unlink ${r.owner}/${r.repo}`}
                    onClick={() => p.onRemoveRepo(r.owner, r.repo)}
                  >
                    <X size={13} />
                  </span>
                </div>
              )
            })}
          </div>
        )}
        <Field label="Link a repo">
          <input
            className="sfield-input"
            type="text"
            value={p.bridgeInput}
            placeholder="owner/repo or https://owner.github.io/repo"
            onChange={(e) => p.setBridgeInput(e.target.value)}
          />
        </Field>
        <div className="sactions">
          <button className="sbtn" disabled={!p.bridgeInput.trim()} onClick={p.onAddRepo}>
            Link repo
          </button>
          <button
            className="sbtn ghost"
            disabled={p.bridgeFinding || p.githubKeys.length === 0}
            onClick={p.onDiscover}
            title={
              p.githubKeys.length === 0
                ? 'Sign in with GitHub below first'
                : 'Scan your GitHub account'
            }
          >
            {p.bridgeFinding ? 'Searching…' : 'Find my report repos'}
          </button>
          <button className="sbtn ghost" onClick={p.onCheckHealth}>
            Check health
          </button>
        </div>
        {p.bridgeStatus && (
          <div className={`sstatus ${p.bridgeStatus.ok ? 'ok' : 'err'}`}>
            {p.bridgeStatus.msg}
          </div>
        )}
      </Card>

      <Card title="GitHub account">
        <p className="shelp">
          Optional — for private repos / higher rate limits. Public report repos work without
          signing in.
        </p>
        <Keyring keys={p.githubKeys} onActivate={p.onActivateKey} onRemove={p.onRemoveKey} />
        {p.ghUserCode && (
          <div className="sstatus ok">
            Enter code <b>{p.ghUserCode}</b>{' '}
            <button className="sbtn ghost" type="button" onClick={p.onCopyCode}>
              {p.ghCodeCopied ? (
                <>
                  copied <Check size={11} />
                </>
              ) : (
                'copy'
              )}
            </button>{' '}
            at github.com/login/device (opened in your browser).
          </div>
        )}
        <div className="sactions">
          <button className="sbtn" disabled={p.ghSigningIn} onClick={p.onSignIn}>
            {p.ghSigningIn ? 'Signing in…' : 'Sign in with GitHub'}
          </button>
        </div>
        {p.ghAuthStatus && (
          <div className={`sstatus ${p.ghAuthStatus.ok ? 'ok' : 'err'}`}>
            {p.ghAuthStatus.msg}
          </div>
        )}
      </Card>
    </Pane>
  )
}
