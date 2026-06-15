// src/main/meta/progress.ts
//
// Unified "learning" progress contract shared by the meta refresh and the wiki
// reference ingest. Both background jobs report through the same renderer banner,
// each as its own labelled phase, so a 'start' carries a label + total and every
// 'advance' moves that phase's bar by one unit. The detailed per-source
// MetaProgress events stay internal to the refresher; index.ts translates them
// into this shape before sending to the renderer.
export type LearnPhase = 'meta' | 'wiki'

export type LearnProgress =
  | { phase: LearnPhase; kind: 'start'; total: number; label: string }
  | { phase: LearnPhase; kind: 'advance' }
  | { phase: LearnPhase; kind: 'done' }
