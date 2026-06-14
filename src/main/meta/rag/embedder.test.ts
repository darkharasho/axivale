import { describe, it, expect } from 'vitest'
import { TransformersEmbedder } from './embedder'

describe('TransformersEmbedder', () => {
  it('constructs lazily without loading the model', () => {
    // must not throw or download anything at construction time
    const e = new TransformersEmbedder('/tmp/meta-models-test')
    expect(typeof e.embed).toBe('function')
  })
})
