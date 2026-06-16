// jq-web is a WASM build of jq. We load it lazily (first query only) so importing
// this module — and the tools module that re-exports the default engine — stays
// cheap and never blocks app startup or unrelated tests.
// This is the ONLY file that knows about the engine; swap it here if jq-web changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modPromise: Promise<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadJq(): Promise<any> {
  if (!modPromise) {
    modPromise = import('jq-web').then((m) => (m as { default?: unknown }).default ?? m)
  }
  return modPromise
}

export interface JqEngine {
  /** Evaluate `expr` over `input`; returns every output of the jq stream as an array. */
  run(expr: string, input: unknown): Promise<unknown[]>
}

export const jqEngine: JqEngine = {
  async run(expr, input) {
    const jq = await loadJq()
    // Wrap in [ ... ] so a multi-output stream comes back as one JSON array,
    // and a single scalar comes back as a one-element array — a uniform contract.
    const wrapped = `[ ${expr} ]`
    // jq-web's module export is itself a thenable; awaiting `loadJq` resolves it
    // to the ready { json, raw } object, so `json` is callable synchronously here.
    const result = jq.json(input, wrapped)
    return Array.isArray(result) ? result : [result]
  }
}
