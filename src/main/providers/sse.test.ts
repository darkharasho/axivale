import { describe, it, expect } from 'vitest'
import { sseData } from './sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const data of sseData(stream)) out.push(data)
  return out
}

describe('sseData', () => {
  it('yields data payloads and skips [DONE], comments, and blank lines', async () => {
    const stream = streamOf('data: {"a":1}\n\n: keepalive\n\ndata: {"b":2}\n\ndata: [DONE]\n\n')
    expect(await collect(stream)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('reassembles events split across network chunks', async () => {
    const stream = streamOf('data: {"long', '":"val', 'ue"}\n\n')
    expect(await collect(stream)).toEqual(['{"long":"value"}'])
  })

  it('handles CRLF line endings', async () => {
    const stream = streamOf('data: {"x":1}\r\n\r\n')
    expect(await collect(stream)).toEqual(['{"x":1}'])
  })
})
