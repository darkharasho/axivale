// src/main/meta/rag/embedder.ts
//
// Local sentence embeddings via transformers.js (all-MiniLM-L6-v2, 384-dim).
// Lazy-loaded; the model is cached under userData. Behind the Embedder interface
// so the index/tests can inject a fake. Prefer the WASM backend to avoid a
// native ONNX dependency (LanceDB is the only native dep).
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

export const EMBED_DIM = 384
const MODEL = 'Xenova/all-MiniLM-L6-v2'

export class TransformersEmbedder implements Embedder {
  // typed loosely: the transformers.js pipeline type is dynamic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: any = null

  constructor(private readonly cacheDir: string) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async pipe(): Promise<any> {
    if (this.extractor) return this.extractor
    const { pipeline, env } = await import('@xenova/transformers')
    env.allowLocalModels = false
    env.cacheDir = this.cacheDir
    this.extractor = await pipeline('feature-extraction', MODEL)
    return this.extractor
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const extractor = await this.pipe()
    const out = await extractor(texts, { pooling: 'mean', normalize: true })
    // out is a Tensor; .tolist() yields number[][]
    return out.tolist() as number[][]
  }
}
