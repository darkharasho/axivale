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

export interface ShareDoc {
  v: 1
  id: string
  kind: ShareKind
  title: string
  createdAt: string
  app: { name: string; version: string }
  turns: SharedTurn[]
}
