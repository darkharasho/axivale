// src/main/shareTypes.ts
//
// The on-disk shape written to shares/<id>.json in the user's axivale-shares
// repo, and rendered by the share-viewer SPA. Deliberately self-contained and
// redacted: raw tool inputs/results are NEVER included (see shareSanitize.ts).
// A byte-for-byte copy lives at src/share-viewer/shareTypes.ts because the
// viewer must not import from src/main — keep them in sync.

import type { DisplayPayload } from './providers/types'

export type ShareKind = 'conversation' | 'response'

/** A tool as shown in a share: name + optional visible rich card; no inputs/results. */
export interface SharedTool {
  name: string
  display?: DisplayPayload
}

export interface SharedTurn {
  /** Present for conversation shares; omitted for single-response shares. */
  userText?: string
  agentText: string
  filedAt: string
  tools: SharedTool[]
}

/** A resolved GW2 entity referenced by a `[[type:Name]]` marker in the turns,
 *  baked in at publish time so the viewer (no Electron/API) can render the chip
 *  + icon without resolving anything. Only referenced entities are kept. */
export interface ShareEntity {
  name: string
  type: 'skill' | 'trait' | 'item'
  icon?: string
}

export interface ShareDoc {
  v: 1
  id: string
  kind: ShareKind
  title: string
  createdAt: string
  app: { name: string; version: string }
  turns: SharedTurn[]
  /** Entities referenced by `[[…]]` markers in the turns; omitted when none. */
  entities?: ShareEntity[]
}
