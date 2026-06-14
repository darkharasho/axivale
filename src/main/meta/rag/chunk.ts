// src/main/meta/rag/chunk.ts
//
// Pure chunker: split a page's text into overlapping word-bounded passages,
// each carrying the page metadata, a stable id, and the page-level contentHash
// (so ingestion can skip unchanged pages). No I/O.
import { createHash } from 'crypto'

export interface ChunkMeta {
  mode: string
  source: string
  url: string
  title: string
}
export interface Chunk extends ChunkMeta {
  id: string
  text: string
  contentHash: string
}

const TARGET_WORDS = 320 // ~250–400 word passages
const OVERLAP_WORDS = 30 // ~1 sentence of overlap so a tradeoff isn't sliced

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

export function chunkPage(text: string, meta: ChunkMeta): Chunk[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const contentHash = sha1(text)
  const urlHash = sha1(meta.url)
  const chunks: Chunk[] = []
  const step = TARGET_WORDS - OVERLAP_WORDS
  for (let start = 0, idx = 0; start < words.length; start += step, idx++) {
    const slice = words.slice(start, start + TARGET_WORDS)
    chunks.push({ ...meta, id: `${urlHash}:${idx}`, text: slice.join(' '), contentHash })
    if (start + TARGET_WORDS >= words.length) break
  }
  return chunks
}
