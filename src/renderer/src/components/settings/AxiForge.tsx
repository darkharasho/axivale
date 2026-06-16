import type { ReactElement } from 'react'
import { Pane, Card } from '../panelui'

export type ForgeStatus =
  | { state: 'connected'; version: string }
  | { state: 'file-only' }
  | { state: 'offline' }
  | null

export interface AxiForgeProps {
  forgeStatus: ForgeStatus
  forgeLaunching: boolean
  onLaunch: () => void
  onRecheck: () => void
}

export default function AxiForge({
  forgeStatus,
  forgeLaunching,
  onLaunch,
  onRecheck
}: AxiForgeProps): ReactElement {
  const status =
    forgeStatus === null
      ? { msg: 'checking…', tone: 'dim' as const }
      : forgeStatus.state === 'connected'
        ? { msg: `connected · v${forgeStatus.version}`, tone: 'ok' as const }
        : forgeStatus.state === 'file-only'
          ? { msg: 'file-only · builds read from disk', tone: 'ok' as const }
          : { msg: 'not found', tone: 'err' as const }
  return (
    <Pane no="04" title="AxiForge" sub="Local build & comp editor connection.">
      <Card title="Connection" status={status}>
        {forgeStatus?.state === 'offline' && (
          <p className="shelp">Not found — install AxiForge via AxiOM.</p>
        )}
        <div className="sactions">
          {forgeStatus &&
            forgeStatus.state !== 'connected' &&
            forgeStatus.state !== 'offline' && (
              <button className="sbtn" disabled={forgeLaunching} onClick={onLaunch}>
                {forgeLaunching ? 'Starting…' : 'Launch AxiForge'}
              </button>
            )}
          <button className="sbtn ghost" onClick={onRecheck}>
            Recheck
          </button>
        </div>
        <p className="shelp">
          AxiVale edits AxiForge builds and comps through its local API. No setup needed — the
          connection is discovered automatically when AxiForge runs on this machine.
        </p>
      </Card>
    </Pane>
  )
}
