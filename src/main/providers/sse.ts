/**
 * Iterates the `data:` payloads of a Server-Sent-Events body.
 * Skips comments, blank lines, and the OpenAI-style `[DONE]` sentinel.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data && data !== '[DONE]') yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}
