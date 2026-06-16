// jq-web ships no type declarations. Minimal ambient types for the surface we use.
// The default export is a thenable that resolves to the ready jq object exposing
// synchronous `json`/`raw`. (It also has a `promised` async API, declared for
// completeness.) See jqEngine.ts — the only consumer.
declare module 'jq-web' {
  interface JqReady {
    json(input: unknown, filter: string): unknown
    raw(jsonString: string, filter: string, flags?: string[]): string
  }
  interface JqWeb extends JqReady, PromiseLike<JqReady> {
    promised: {
      json(input: unknown, filter: string): Promise<unknown>
      raw(jsonString: string, filter: string, flags?: string[]): Promise<string>
    }
  }
  const jq: JqWeb
  export default jq
}
