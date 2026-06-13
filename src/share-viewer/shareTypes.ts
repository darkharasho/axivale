// src/share-viewer/shareTypes.ts
// Byte-for-byte copy of src/main/shareTypes.ts (the viewer must not import from
// src/main). The renderer already duplicates DisplayPayload in state.ts; reuse it.
import type { DisplayPayload } from '../renderer/src/state'

export type ShareKind = 'conversation' | 'response'
export interface SharedTool {
  name: string
  display?: DisplayPayload
}
export interface SharedTurn {
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
